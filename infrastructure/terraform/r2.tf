resource "cloudflare_r2_bucket" "skills" {
  account_id    = var.cloudflare_account_id
  name          = var.skills_bucket_name
  location      = var.r2_location
  storage_class = var.r2_storage_class
}

resource "cloudflare_r2_bucket" "reports" {
  account_id    = var.cloudflare_account_id
  name          = var.reports_bucket_name
  location      = var.r2_location
  storage_class = var.r2_storage_class
}

resource "cloudflare_r2_bucket" "meta" {
  account_id    = var.cloudflare_account_id
  name          = var.meta_bucket_name
  location      = var.r2_location
  storage_class = var.r2_storage_class
}
