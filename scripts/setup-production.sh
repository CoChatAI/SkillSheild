#!/usr/bin/env bash
#
# SkillShield production setup script.
#
# Handles the full deployment in the correct dependency order:
#   1. Collect required inputs
#   2. Generate secrets
#   3. Save everything to .secrets for recovery
#   4. Apply Terraform
#   5. Set Fly scanner secrets and deploy scanner
#   6. Set Worker secrets, apply D1 schema, deploy Worker
#   7. Set GitHub CI secrets
#   8. Run a bounded scrape to verify end-to-end
#
# Usage:
#   ./scripts/setup-production.sh
#
# Requires: gh, terraform, flyctl, docker, node 22+, curl, openssl
# Run from the repo root.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS_FILE="$REPO_ROOT/.secrets"
GITHUB_REPO="CoChatAI/SkillSheild"
FLY_APP="skillshield-scanner"
FLY_ORG="cochat-inc"
WORKER_DIR="$REPO_ROOT/packages/worker"
TF_DIR="$REPO_ROOT/infrastructure/terraform"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

info()  { printf "\n\033[1;34m==> %s\033[0m\n" "$*"; }
ok()    { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }
warn()  { printf "\033[1;33m  ! %s\033[0m\n" "$*"; }
fail()  { printf "\033[1;31m  ✗ %s\033[0m\n" "$*"; exit 1; }

prompt_value() {
  local varname="$1" prompt="$2" default="${3:-}"
  if [[ -n "$default" ]]; then
    read -rp "  $prompt [$default]: " val
    val="${val:-$default}"
  else
    read -rp "  $prompt: " val
  fi
  [[ -z "$val" ]] && fail "Required value: $prompt"
  eval "$varname=\"\$val\""
}

require_tool() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required tool: $1"
}

generate_secret() {
  openssl rand -hex 32
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

info "Checking required tools"
for tool in gh terraform flyctl docker node curl openssl; do
  require_tool "$tool"
  ok "$tool"
done

cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Load or collect inputs
# ---------------------------------------------------------------------------

if [[ -f "$SECRETS_FILE" ]]; then
  info "Found existing .secrets file"
  # shellcheck disable=SC1090
  source "$SECRETS_FILE"
  ok "Loaded saved values from .secrets"
  echo ""
  echo "  To start fresh, delete .secrets and re-run this script."
  echo ""
fi

info "Collecting Cloudflare values"
echo "  Find these in the Cloudflare dashboard:"
echo "    Account ID:  dashboard home or right sidebar"
echo "    Zone ID:     Websites -> cochat.ai -> Overview -> right sidebar"
echo "    Workers subdomain: Workers & Pages -> Overview"
echo ""

prompt_value CF_ACCOUNT_ID            "Cloudflare Account ID"            "${CF_ACCOUNT_ID:-}"
prompt_value CF_ZONE_ID               "Cloudflare Zone ID (cochat.ai)"   "${CF_ZONE_ID:-}"
prompt_value CF_WORKERS_SUBDOMAIN     "Workers subdomain (e.g. marcel-af4)" "${CF_WORKERS_SUBDOMAIN:-}"

info "Collecting Cloudflare API tokens"
echo "  You need 3 Cloudflare API tokens (create at My Profile -> API Tokens -> Custom Token):"
echo ""
echo "  Token 1 - Worker deploy token:"
echo "    Account: Workers Scripts Edit, D1 Edit, Queues Edit, Workers R2 Storage Edit"
echo "    Zone: Workers Routes Edit"
echo ""
echo "  Token 2 - Terraform infra token:"
echo "    Account: D1 Edit, Queues Edit, Workers R2 Storage Edit"
echo "    Zone: Workers Routes Edit, DNS Edit"
echo ""
echo "  Token 3 - Scanner runtime token (D1 only):"
echo "    Account: D1 Edit"
echo ""

prompt_value CF_WORKER_DEPLOY_TOKEN   "Worker deploy Cloudflare API token"   "${CF_WORKER_DEPLOY_TOKEN:-}"
prompt_value CF_TERRAFORM_TOKEN       "Terraform infra Cloudflare API token" "${CF_TERRAFORM_TOKEN:-}"
prompt_value CF_SCANNER_TOKEN         "Scanner runtime Cloudflare API token" "${CF_SCANNER_TOKEN:-}"

info "Collecting R2 S3-compatible credentials"
echo "  Create at: Cloudflare -> Storage & databases -> R2 -> Overview"
echo "  Right sidebar -> Account Details -> API Tokens -> Manage"
echo ""

prompt_value R2_ACCESS_KEY_ID         "R2 Access Key ID"         "${R2_ACCESS_KEY_ID:-}"
prompt_value R2_SECRET_ACCESS_KEY     "R2 Secret Access Key"     "${R2_SECRET_ACCESS_KEY:-}"

R2_ENDPOINT="https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com"
ok "R2 endpoint: $R2_ENDPOINT"

info "Collecting Fly.io token"
echo "  Create at: fly.io -> account settings -> access tokens"
echo ""

prompt_value FLY_API_TOKEN            "Fly deploy token"         "${FLY_API_TOKEN:-}"

# ---------------------------------------------------------------------------
# Generate secrets (or reuse saved ones)
# ---------------------------------------------------------------------------

info "Generating application secrets"

if [[ -z "${WEBHOOK_SECRET:-}" ]]; then
  WEBHOOK_SECRET="$(generate_secret)"
  ok "Generated WEBHOOK_SECRET"
else
  ok "Reusing saved WEBHOOK_SECRET"
fi

if [[ -z "${SCANNER_AUTH_TOKEN:-}" ]]; then
  SCANNER_AUTH_TOKEN="$(generate_secret)"
  ok "Generated SCANNER_AUTH_TOKEN"
else
  ok "Reusing saved SCANNER_AUTH_TOKEN"
fi

# ---------------------------------------------------------------------------
# Save everything to .secrets
# ---------------------------------------------------------------------------

info "Saving all values to .secrets (gitignored)"

cat > "$SECRETS_FILE" <<EOF
# SkillShield production secrets - generated by setup-production.sh
# This file is gitignored. Keep it safe. Delete after deployment is verified.

# Cloudflare
CF_ACCOUNT_ID="$CF_ACCOUNT_ID"
CF_ZONE_ID="$CF_ZONE_ID"
CF_WORKERS_SUBDOMAIN="$CF_WORKERS_SUBDOMAIN"
CF_WORKER_DEPLOY_TOKEN="$CF_WORKER_DEPLOY_TOKEN"
CF_TERRAFORM_TOKEN="$CF_TERRAFORM_TOKEN"
CF_SCANNER_TOKEN="$CF_SCANNER_TOKEN"

# R2
R2_ENDPOINT="$R2_ENDPOINT"
R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"

# Fly
FLY_API_TOKEN="$FLY_API_TOKEN"

# Application secrets (generated)
WEBHOOK_SECRET="$WEBHOOK_SECRET"
SCANNER_AUTH_TOKEN="$SCANNER_AUTH_TOKEN"
EOF

chmod 600 "$SECRETS_FILE"
ok "Saved to .secrets"

# ---------------------------------------------------------------------------
# Step 1: Terraform
# ---------------------------------------------------------------------------

info "Step 1: Applying Terraform"

WORKER_DNS_TARGET="skillshield-worker-production.${CF_WORKERS_SUBDOMAIN}.workers.dev"

cat > "$TF_DIR/production.auto.tfvars" <<EOF
cloudflare_account_id = "$CF_ACCOUNT_ID"
cloudflare_zone_id    = "$CF_ZONE_ID"
worker_dns_target     = "$WORKER_DNS_TARGET"
EOF

ok "Wrote Terraform vars"

export CLOUDFLARE_API_TOKEN="$CF_TERRAFORM_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"

(
  cd "$TF_DIR"
  terraform init -input=false
  terraform apply -auto-approve
)

D1_DATABASE_ID="$(cd "$TF_DIR" && terraform output -raw d1_database_id)"
ok "D1 database ID: $D1_DATABASE_ID"

# Save D1 ID back to .secrets
echo "" >> "$SECRETS_FILE"
echo "# Terraform outputs" >> "$SECRETS_FILE"
echo "D1_DATABASE_ID=\"$D1_DATABASE_ID\"" >> "$SECRETS_FILE"

# ---------------------------------------------------------------------------
# Step 2: Deploy Worker first (so the script exists for the route)
# ---------------------------------------------------------------------------

info "Step 2: Initial Worker deploy"

# Switch to the Worker deploy token for all Wrangler commands
export CLOUDFLARE_API_TOKEN="$CF_WORKER_DEPLOY_TOKEN"

# Update wrangler.toml D1 database ID if it still has the placeholder
if grep -q 'terraform-output-placeholder' "$WORKER_DIR/wrangler.toml"; then
  sed -i.bak "s/terraform-output-placeholder/$D1_DATABASE_ID/" "$WORKER_DIR/wrangler.toml"
  rm -f "$WORKER_DIR/wrangler.toml.bak"
  ok "Updated wrangler.toml D1 database ID"
fi

(
  cd "$WORKER_DIR"
  npx pnpm@10.6.3 exec wrangler deploy --env production --config wrangler.toml
)

ok "Worker deployed"

# ---------------------------------------------------------------------------
# Step 3: Set Worker runtime secrets
# ---------------------------------------------------------------------------

info "Step 3: Setting Worker runtime secrets"

(
  cd "$WORKER_DIR"
  echo "$WEBHOOK_SECRET" | npx pnpm@10.6.3 exec wrangler secret put WEBHOOK_SECRET --env production
  echo "$SCANNER_AUTH_TOKEN" | npx pnpm@10.6.3 exec wrangler secret put SCANNER_AUTH_TOKEN --env production
)

ok "Worker secrets set"

# ---------------------------------------------------------------------------
# Step 4: Apply D1 schema
# ---------------------------------------------------------------------------

info "Step 4: Applying D1 schema"

(
  cd "$WORKER_DIR"
  npx pnpm@10.6.3 exec wrangler d1 execute skillshield-db --env production --remote --file schema.sql
)

ok "D1 schema applied"

# ---------------------------------------------------------------------------
# Step 5: Create Fly app and deploy scanner
# ---------------------------------------------------------------------------

info "Step 5: Deploying scanner to Fly"

export FLY_API_TOKEN="$FLY_API_TOKEN"

# Create app if it doesn't exist
if ! flyctl status --app "$FLY_APP" >/dev/null 2>&1; then
  flyctl apps create "$FLY_APP" --org "$FLY_ORG"
  ok "Created Fly app: $FLY_APP in $FLY_ORG"
else
  ok "Fly app already exists: $FLY_APP"
fi

flyctl secrets set \
  SCANNER_AUTH_TOKEN="$SCANNER_AUTH_TOKEN" \
  CF_ACCOUNT_ID="$CF_ACCOUNT_ID" \
  CF_API_TOKEN="$CF_SCANNER_TOKEN" \
  D1_DATABASE_ID="$D1_DATABASE_ID" \
  R2_ENDPOINT="$R2_ENDPOINT" \
  R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  --app "$FLY_APP"

ok "Fly secrets set"

flyctl deploy \
  --config packages/scanner/fly.toml \
  --dockerfile packages/scanner/Dockerfile \
  --remote-only \
  --app "$FLY_APP"

ok "Scanner deployed"

# Wait for health
info "Waiting for scanner health check"
for i in $(seq 1 30); do
  if curl -fsS "https://${FLY_APP}.fly.dev/health" >/dev/null 2>&1; then
    ok "Scanner healthy: https://${FLY_APP}.fly.dev/health"
    break
  fi
  if [[ "$i" -eq 30 ]]; then
    fail "Scanner did not become healthy after 30 attempts"
  fi
  sleep 5
done

# ---------------------------------------------------------------------------
# Step 6: Verify Worker health
# ---------------------------------------------------------------------------

info "Step 6: Verifying Worker health"

for i in $(seq 1 10); do
  if curl -fsS "https://skillshield.cochat.ai/health" >/dev/null 2>&1; then
    ok "Worker healthy: https://skillshield.cochat.ai/health"
    break
  fi
  if [[ "$i" -eq 10 ]]; then
    warn "Worker health check failed — may need a moment to propagate"
  fi
  sleep 3
done

# ---------------------------------------------------------------------------
# Step 7: Set GitHub CI secrets
# ---------------------------------------------------------------------------

info "Step 7: Setting GitHub CI secrets"

gh secret set CLOUDFLARE_API_TOKEN  --repo "$GITHUB_REPO" --env production --body "$CF_WORKER_DEPLOY_TOKEN"
gh secret set CLOUDFLARE_ACCOUNT_ID --repo "$GITHUB_REPO" --env production --body "$CF_ACCOUNT_ID"
gh secret set FLY_API_TOKEN         --repo "$GITHUB_REPO" --env production --body "$FLY_API_TOKEN"
gh secret set SCANNER_AUTH_TOKEN    --repo "$GITHUB_REPO" --env production --body "$SCANNER_AUTH_TOKEN"

# Repo variable (not a secret)
gh variable set SCANNER_BASE_URL --repo "$GITHUB_REPO" --body "https://${FLY_APP}.fly.dev"

ok "GitHub secrets and variables set"

# ---------------------------------------------------------------------------
# Step 8: Bounded scrape
# ---------------------------------------------------------------------------

info "Step 8: Running bounded scrape (clawhub, limit=3)"

SCRAPE_RESULT=$(curl --fail-with-body --show-error --silent \
  -X POST \
  -H "Authorization: Bearer $SCANNER_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  "https://${FLY_APP}.fly.dev/scrape/clawhub?wait=true&limit=3" 2>&1) || true

echo "  $SCRAPE_RESULT"

if echo "$SCRAPE_RESULT" | grep -q '"started":true'; then
  ok "Bounded scrape completed"
else
  warn "Bounded scrape may have failed — check output above"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

info "Setup complete"

echo ""
echo "  What was deployed:"
echo "    Worker:  https://skillshield.cochat.ai"
echo "    Scanner: https://${FLY_APP}.fly.dev"
echo ""
echo "  Secrets saved to: .secrets"
echo "    Keep this file safe. Delete it after you've confirmed everything works."
echo ""
echo "  Remaining manual steps:"
echo "    1. Run full scrapes (clawhub, then skills-sh)"
echo "    2. Register upstream webhooks:"
echo "       - ClawHub:  https://skillshield.cochat.ai/webhooks/clawhub"
echo "       - GitHub:   https://skillshield.cochat.ai/webhooks/github"
echo "       Use WEBHOOK_SECRET from .secrets for both"
echo ""
echo "  Verify:"
echo "    curl https://skillshield.cochat.ai/health"
echo "    curl https://skillshield.cochat.ai/api/v1/stats"
echo "    curl https://skillshield.cochat.ai/api/v1/recent"
echo "    curl https://skillshield.cochat.ai/"
echo ""
