resource "cloudflare_d1_database" "primary" {
  account_id = var.cloudflare_account_id
  name       = var.d1_database_name

  jurisdiction          = var.d1_jurisdiction
  primary_location_hint = var.d1_primary_location_hint

  lifecycle {
    ignore_changes = [read_replication]
  }
}
