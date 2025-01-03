terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "2.34.0"
    }
    kubectl = {
      source  = "alekc/kubectl"
      version = "2.1.3"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "5.80.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.6.3"
    }
    vault = {
      source  = "hashicorp/vault"
      version = "4.5.0"
    }
    pf = {
      source = "panfactum/pf"
      version = "0.0.7"
    }
  }
}

data "aws_region" "current" {}

locals {
  namespace = module.namespace.namespace
  ci_image = "${module.pull_through.ecr_public_registry}/${module.constants.panfactum_image_repository}:${module.constants.panfactum_image_tag}"
}

module "pull_through" {
  source =   "${var.pf_module_source}aws_ecr_pull_through_cache_addresses${var.pf_module_ref}"
  pull_through_cache_enabled = true
}

module "constants" {
  source = "${var.pf_module_source}kube_constants${var.pf_module_ref}"
}

module "namespace" {
  source =   "${var.pf_module_source}kube_namespace${var.pf_module_ref}"

  namespace = "cicd"
}
