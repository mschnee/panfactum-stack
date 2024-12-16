#!/usr/bin/env bash

set -eo pipefail

###########################################################
## Step 1: CD to the codebase
###########################################################
cd /code/stack || exit

###########################################################
## Step 2: Get BuildKit address
###########################################################
BUILDKIT_HOST=$(pf-buildkit-get-address --arch=arm64)
export BUILDKIT_HOST

###########################################################
## Step 3: Record the build
###########################################################
pf-buildkit-record-build --arch=arm64

###########################################################
## Step 4: Get AWS credentials for the s3 upload
###########################################################
CREDS=$(aws configure export-credentials)
AWS_ACCESS_KEY_ID=$(echo "$CREDS" | jq -r .AccessKeyId)
AWS_SECRET_ACCESS_KEY=$(echo "$CREDS" | jq -r .SecretAccessKey)
AWS_SESSION_TOKEN=$(echo "$CREDS" | jq -r .SessionToken)
export AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY
export AWS_SESSION_TOKEN

###########################################################
## Step 5: Build the image
###########################################################
buildctl \
  build \
  --frontend=dockerfile.v0 \
  --output "type=image,name=astro-builder:latest,push=false" \
  --local context=. \
  --local dockerfile=./packages/website-2 \
  --opt filename=./Containerfile \
  --secret id=AWS_ACCESS_KEY_ID,env=AWS_ACCESS_KEY_ID \
  --secret id=AWS_SECRET_ACCESS_KEY,env=AWS_SECRET_ACCESS_KEY \
  --secret id=AWS_SESSION_TOKEN,env=AWS_SESSION_TOKEN \
  --opt build-arg:PUBLIC_ALGOLIA_APP_ID="$PUBLIC_ALGOLIA_APP_ID" \
  --opt build-arg:PUBLIC_ALGOLIA_SEARCH_API_KEY="$PUBLIC_ALGOLIA_SEARCH_API_KEY" \
  --opt build-arg:PUBLIC_ALGOLIA_INDEX_NAME="$PUBLIC_ALGOLIA_INDEX_NAME" \
  --export-cache "type=s3,region=$BUILDKIT_BUCKET_REGION,bucket=$BUILDKIT_BUCKET_NAME,name=astro-builder" \
  --import-cache "type=s3,region=$BUILDKIT_BUCKET_REGION,bucket=$BUILDKIT_BUCKET_NAME,name=astro-builder"