# The Worker route is managed by Wrangler via the routes config in wrangler.toml.
# Do not also manage it here or Terraform and Wrangler will conflict.

resource "cloudflare_dns_record" "worker_hostname" {
  zone_id = var.cloudflare_zone_id
  name    = local.worker_hostname
  type    = var.worker_dns_record_type
  content = var.worker_dns_target
  ttl     = var.worker_dns_ttl
  proxied = var.worker_dns_proxied
  comment = "SkillShield public worker hostname (${var.environment})"
}
