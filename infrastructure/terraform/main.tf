terraform {
  required_version = ">= 1.7.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = ">= 5.0.0"
    }
  }
}

provider "cloudflare" {}

locals {
  worker_hostname = trimsuffix(var.worker_route, "/*")
}
