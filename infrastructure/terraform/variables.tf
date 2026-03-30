variable "cloudflare_account_id" {
  description = "Cloudflare account ID that owns the D1, R2, and Queue resources."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for the public SkillShield hostname."
  type        = string
}

variable "environment" {
  description = "Deployment environment label used in resource metadata and outputs."
  type        = string
  default     = "production"
}

variable "worker_name" {
  description = "Cloudflare Worker script name."
  type        = string
  default     = "skillshield-worker"
}

variable "worker_route" {
  description = "Public route pattern attached to the Worker script."
  type        = string
  default     = "skillshield.cochat.ai/*"
}

variable "worker_dns_target" {
  description = "DNS target for the public SkillShield hostname. Override with the real Cloudflare-managed target at cutover time."
  type        = string
}

variable "worker_dns_record_type" {
  description = "DNS record type for the public SkillShield hostname."
  type        = string
  default     = "CNAME"
}

variable "worker_dns_ttl" {
  description = "TTL for the public SkillShield DNS record. Use 1 for Cloudflare automatic TTL."
  type        = number
  default     = 1
}

variable "worker_dns_proxied" {
  description = "Whether the public SkillShield DNS record is proxied through Cloudflare."
  type        = bool
  default     = true
}

variable "d1_database_name" {
  description = "Cloudflare D1 database name for SkillShield application state."
  type        = string
  default     = "skillshield-db"
}

variable "d1_primary_location_hint" {
  description = "Preferred D1 primary location hint."
  type        = string
  default     = "wnam"
}

variable "d1_jurisdiction" {
  description = "Optional D1 data jurisdiction. Leave null to use the account default."
  type        = string
  default     = null
}

variable "r2_location" {
  description = "Best-effort initial location for R2 buckets."
  type        = string
  default     = "WNAM"
}

variable "r2_storage_class" {
  description = "Storage class for the SkillShield R2 buckets."
  type        = string
  default     = "Standard"
}

variable "skills_bucket_name" {
  description = "R2 bucket name for published skill artifacts."
  type        = string
  default     = "skillshield-skills"
}

variable "reports_bucket_name" {
  description = "R2 bucket name for generated scan reports."
  type        = string
  default     = "skillshield-reports"
}

variable "meta_bucket_name" {
  description = "R2 bucket name for metadata and sync cursors."
  type        = string
  default     = "skillshield-meta"
}

variable "scan_queue_name" {
  description = "Cloudflare Queue name used between webhook ingestion and scan execution."
  type        = string
  default     = "scan-jobs"
}

variable "scanner_app_name" {
  description = "Fly application name for the scanner service."
  type        = string
  default     = "skillshield-scanner"
}
