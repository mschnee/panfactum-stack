// Module

terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "5.80.0"
      configuration_aliases = [aws.global]
    }
    pf = {
      source  = "panfactum/pf"
      version = "0.0.7"
    }
  }
}

data "pf_aws_tags" "tags" {
  module          = "aws_dnssec"
  region_override = "us-east-1"
}

##########################################################################
## DNSSEC Setup
##########################################################################

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "key" {
  statement {
    sid    = "Allow Route 53 DNSSEC Service"
    effect = "Allow"
    actions = [
      "kms:DescribeKey",
      "kms:GetPublicKey",
      "kms:Sign",
      "kms:Verify",
    ]
    principals {
      identifiers = ["dnssec-route53.amazonaws.com"]
      type        = "Service"
    }
    resources = ["*"]
    condition {
      test     = "StringEquals"
      values   = [data.aws_caller_identity.current.account_id]
      variable = "aws:SourceAccount"
    }
    condition {
      test     = "ArnLike"
      values   = ["arn:aws:route53:::hostedzone/*"]
      variable = "aws:SourceArn"
    }
  }

  statement {
    sid    = "Allow Route 53 DNSSEC Service to CreateGrant"
    effect = "Allow"
    actions = [
      "kms:CreateGrant",
    ]
    principals {
      identifiers = ["dnssec-route53.amazonaws.com"]
      type        = "Service"
    }
    condition {
      test     = "Bool"
      values   = ["true"]
      variable = "kms:GrantIsForAWSResource"
    }
    resources = ["*"]
  }

  statement {
    sid     = "Allow IAM user access"
    effect  = "Allow"
    actions = ["kms:*"]
    principals {
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
      type        = "AWS"
    }
    resources = ["*"]
  }
}

resource "aws_kms_key" "key" {
  provider                 = aws.global
  customer_master_key_spec = "ECC_NIST_P256"
  deletion_window_in_days  = 7
  key_usage                = "SIGN_VERIFY"
  policy                   = data.aws_iam_policy_document.key.json
  tags = merge(data.pf_aws_tags.tags.tags, {
    description = "Key used to sign records for DNSSEC"
  })
}

resource "aws_route53_key_signing_key" "keys" {
  for_each                   = var.hosted_zones
  hosted_zone_id             = each.value
  key_management_service_arn = aws_kms_key.key.arn
  name                       = "${each.key}-dnssec"
}

resource "aws_route53_hosted_zone_dnssec" "dnssec" {
  for_each       = var.hosted_zones
  hosted_zone_id = each.value

  depends_on = [aws_route53_key_signing_key.keys]
}
