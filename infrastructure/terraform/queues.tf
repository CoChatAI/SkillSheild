resource "cloudflare_queue" "scan_jobs" {
  account_id = var.cloudflare_account_id
  queue_name = var.scan_queue_name
}
