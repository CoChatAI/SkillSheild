resource "cloudflare_workers_route" "worker" {
  zone_id = var.cloudflare_zone_id
  pattern = var.worker_route
  script  = var.worker_name
}

resource "cloudflare_dns_record" "worker_hostname" {
  zone_id = var.cloudflare_zone_id
  name    = local.worker_hostname
  type    = var.worker_dns_record_type
  content = var.worker_dns_target
  ttl     = var.worker_dns_ttl
  proxied = var.worker_dns_proxied
  comment = "SkillShield public worker hostname (${var.environment})"
}
