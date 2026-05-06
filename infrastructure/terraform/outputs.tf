output "environment" {
  description = "Deployment environment label for this Terraform stack."
  value       = var.environment
}

output "worker_name" {
  description = "Cloudflare Worker script name."
  value       = var.worker_name
}

output "worker_route" {
  description = "Cloudflare Worker route pattern."
  value       = var.worker_route
}

output "worker_hostname" {
  description = "Public SkillShield hostname derived from the Worker route."
  value       = local.worker_hostname
}

output "worker_dns_record_id" {
  description = "DNS record identifier for the public SkillShield hostname."
  value       = cloudflare_dns_record.worker_hostname.id
}

output "worker_dns_record_name" {
  description = "DNS record name for the public SkillShield hostname."
  value       = cloudflare_dns_record.worker_hostname.name
}

output "worker_dns_target" {
  description = "DNS record target for the public SkillShield hostname."
  value       = cloudflare_dns_record.worker_hostname.content
}

output "d1_database_name" {
  description = "SkillShield D1 database name."
  value       = cloudflare_d1_database.primary.name
}

output "d1_database_id" {
  description = "SkillShield D1 database identifier for Wrangler and deploy wiring."
  value       = cloudflare_d1_database.primary.id
}

output "skills_bucket_name" {
  description = "R2 bucket name for published skill artifacts."
  value       = cloudflare_r2_bucket.skills.name
}

output "reports_bucket_name" {
  description = "R2 bucket name for generated reports."
  value       = cloudflare_r2_bucket.reports.name
}

output "meta_bucket_name" {
  description = "R2 bucket name for metadata and sync cursors."
  value       = cloudflare_r2_bucket.meta.name
}

output "scan_queue_name" {
  description = "Cloudflare Queue name for scan jobs."
  value       = cloudflare_queue.scan_jobs.queue_name
}

output "scan_queue_id" {
  description = "Cloudflare Queue identifier for scan jobs."
  value       = cloudflare_queue.scan_jobs.id
}

output "scanner_app_name" {
  description = "Fly application name for the scanner service."
  value       = var.scanner_app_name
}
