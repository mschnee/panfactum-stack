// Live

terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "2.27.0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "5.39.1"
    }
  }
}

locals {
  restricted_readers_group = "system:restricted-readers"
  readers_group            = "system:readers"
  admins_group             = "system:admins"
  superusers_group         = "system:superusers"


  superuser_role_arns = tolist(toset(concat(
    var.kube_superuser_role_arns,
    ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"],
    [
      for parts in [for arn in data.aws_iam_roles.superuser.arns : split("/", arn)] :
      format("%s/%s", parts[0], element(parts, length(parts) - 1))
    ]
  )))
  admin_role_arns = tolist(toset(concat(
    var.kube_admin_role_arns,
    [
      for parts in [for arn in data.aws_iam_roles.admin.arns : split("/", arn)] :
      format("%s/%s", parts[0], element(parts, length(parts) - 1))
    ]
  )))
  reader_role_arns = tolist(toset(concat(
    var.kube_reader_role_arns,
    [
      for parts in [for arn in data.aws_iam_roles.reader.arns : split("/", arn)] :
      format("%s/%s", parts[0], element(parts, length(parts) - 1))
    ]
  )))
  restricted_reader_role_arns = tolist(toset(concat(
    var.kube_restricted_reader_role_arns,
    [
      for parts in [for arn in data.aws_iam_roles.restricted_reader.arns : split("/", arn)] :
      format("%s/%s", parts[0], element(parts, length(parts) - 1))
    ]
  )))
}

module "kube_labels" {
  source = "../kube_labels"

  pf_stack_edition = var.pf_stack_edition
  pf_stack_version = var.pf_stack_version
  pf_stack_commit  = var.pf_stack_commit
  environment      = var.environment
  pf_root_module   = var.pf_root_module
  pf_module        = var.pf_module
  region           = var.region
  is_local         = var.is_local
  extra_tags       = var.extra_tags
}

////////////////////////////////////////////////////////////
// User Authentication
// See https://kubernetes.io/docs/reference/access-authn-authz/rbac/#user-facing-roles
////////////////////////////////////////////////////////////

/*******************  Superuser Permissions ***********************/

data "aws_iam_roles" "superuser" {
  name_regex  = "AWSReservedSSO_Superuser.*"
  path_prefix = "/aws-reserved/sso.amazonaws.com/"
}

resource "kubernetes_cluster_role_binding" "superusers" {
  metadata {
    name   = local.superusers_group
    labels = module.kube_labels.kube_labels
  }
  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = "cluster-admin" // built-in role
  }
  subject {
    kind      = "Group"
    name      = local.superusers_group
    api_group = "rbac.authorization.k8s.io"
  }
}

/*******************  Admin Permissions ***********************/

data "aws_iam_roles" "admin" {
  name_regex  = "AWSReservedSSO_Admin.*"
  path_prefix = "/aws-reserved/sso.amazonaws.com/"
}

resource "kubernetes_cluster_role" "admins" {
  metadata {
    name   = local.admins_group
    labels = module.kube_labels.kube_labels
  }
  rule {
    api_groups = [""]
    resources  = ["nodes", "namespaces", "pods", "configmaps", "services", "roles", "secrets"]
    verbs      = ["get", "list", "watch"]
  }
  rule {
    api_groups = ["apps"]
    resources = [
      "daemonsets",
      "deployments",
      "replicasets",
      "statefulsets",
    ]
    verbs = ["get", "list", "watch"]
  }
  rule {
    api_groups = ["policy"]
    resources  = ["poddisruptionbudgets", "poddisruptionbudgets/status"]
    verbs      = ["get", "list", "watch"]
  }
  rule {
    api_groups = ["networking.k8s.io"]
    resources  = ["ingresses", "ingresses/status", "networkpolicies"]
    verbs      = ["get", "list", "watch"]
  }
  rule {
    api_groups = ["metrics.k8s.io"]
    resources  = ["pods", "nodes"]
    verbs      = ["get", "list", "watch"]
  }
  rule {
    api_groups = ["rbac.authorization.k8s.io"]
    resources  = ["clusterroles", "clusterrolebindings"]
    verbs      = ["get", "list", "watch"]
  }
}


resource "kubernetes_cluster_role_binding" "admins" {
  metadata {
    name   = local.admins_group
    labels = module.kube_labels.kube_labels
  }
  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = kubernetes_cluster_role.admins.metadata[0].name
  }
  subject {
    kind      = "Group"
    name      = local.admins_group
    api_group = "rbac.authorization.k8s.io"
  }
}

/*******************  Reader Permissions ***********************/

data "aws_iam_roles" "reader" {
  name_regex  = "AWSReservedSSO_Reader.*"
  path_prefix = "/aws-reserved/sso.amazonaws.com/"
}

resource "kubernetes_cluster_role" "readers" {
  metadata {
    name   = local.readers_group
    labels = module.kube_labels.kube_labels
  }
  rule {
    api_groups = ["*"]
    resources  = ["*"]
    verbs      = ["get", "list", "watch", "view"]
  }
}

resource "kubernetes_cluster_role_binding" "readers" {
  metadata {
    name   = local.readers_group
    labels = module.kube_labels.kube_labels
  }
  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = kubernetes_cluster_role.readers.metadata[0].name
  }
  subject {
    kind      = "Group"
    name      = local.readers_group
    api_group = "rbac.authorization.k8s.io"
  }
}

/*******************  Restricted Reader Permissions ***********************/

data "aws_iam_roles" "restricted_reader" {
  name_regex  = "AWSReservedSSO_RestrictedReader.*"
  path_prefix = "/aws-reserved/sso.amazonaws.com/"
}

resource "kubernetes_cluster_role" "restricted_readers" {
  metadata {
    name   = local.restricted_readers_group
    labels = module.kube_labels.kube_labels
  }
  rule {
    api_groups = ["*"]
    resources  = ["*"]
    verbs      = ["get", "list", "watch", "view"]
  }
  rule {
    api_groups = [""]
    resources  = ["secrets"]
    verbs      = ["list"]
  }
}

resource "kubernetes_cluster_role_binding" "restricted_readers" {
  metadata {
    name   = local.restricted_readers_group
    labels = module.kube_labels.kube_labels
  }
  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = kubernetes_cluster_role.restricted_readers.metadata[0].name
  }
  subject {
    kind      = "Group"
    name      = local.restricted_readers_group
    api_group = "rbac.authorization.k8s.io"
  }
}

/*******************  IAM Mappings ***********************/
// See https://github.com/kubernetes-sigs/aws-iam-authenticator

data "aws_caller_identity" "current" {}

// This is automatically created by EKS so we can declaratively
// import it
import {
  id = "kube-system/aws-auth"
  to = kubernetes_config_map.aws_auth
}

resource "kubernetes_config_map" "aws_auth" {
  metadata {
    name      = "aws-auth"
    namespace = "kube-system"
    labels    = module.kube_labels.kube_labels
  }
  data = {
    mapRoles = yamlencode(concat(

      // allows nodes to register with the cluster
      [{
        rolearn  = var.aws_node_role_arn
        username = "system:node:{{EC2PrivateDNSName}}"
        groups   = ["system:bootstrappers", "system:nodes"]
      }],

      // allows access to superusers
      [for arn in local.superuser_role_arns : {
        rolearn  = arn
        username = "{{SessionName}}"
        groups   = [local.superusers_group]
      }],

      // allows access to admins
      [for arn in local.admin_role_arns : {
        rolearn  = arn
        username = "{{SessionName}}"
        groups   = [local.admins_group]
      }],

      // allows access to read only
      [for arn in local.reader_role_arns : {
        rolearn  = arn
        username = "{{SessionName}}"
        groups   = [local.readers_group]
      }],

      // allows access to read only
      [for arn in local.restricted_reader_role_arns : {
        rolearn  = arn
        username = "{{SessionName}}"
        groups   = [local.restricted_readers_group]
      }]
    ))
  }
}
