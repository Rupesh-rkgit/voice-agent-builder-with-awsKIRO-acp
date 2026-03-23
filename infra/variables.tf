# =============================================================================
# Variables — Voice Agent Studio EC2 Deployment
# =============================================================================

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type (t3.medium recommended for Next.js build)"
  type        = string
  default     = "t3.medium"
}

variable "key_pair_name" {
  description = "Name of an existing EC2 key pair for SSH access. Leave empty to skip SSH key association."
  type        = string
  default     = ""
}

variable "allowed_ssh_cidr" {
  description = "CIDR block allowed to SSH (e.g. your IP: 1.2.3.4/32). Use 0.0.0.0/0 for open access (not recommended)."
  type        = string
  default     = "0.0.0.0/0"
}

variable "github_repo_url" {
  description = "GitHub repository HTTPS URL to clone"
  type        = string
  default     = "https://github.com/Rupesh-rkgit/voice-agent-studio.git"
}

variable "github_branch" {
  description = "Git branch to checkout after clone"
  type        = string
  default     = "VoiceAddition"
}

# ── Environment variables for .env.local ─────────────────────────────────────

variable "aws_bearer_token_bedrock" {
  description = "AWS Bearer Token for Bedrock API (from your .env.local)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "bedrock_model_id" {
  description = "Bedrock model ID"
  type        = string
  default     = "anthropic.claude-sonnet-4-20250514-v1:0"
}

variable "polly_voice_id" {
  description = "AWS Polly voice ID"
  type        = string
  default     = "Joanna"
}

variable "polly_engine" {
  description = "AWS Polly engine (standard or neural)"
  type        = string
  default     = "neural"
}

variable "transcribe_language_code" {
  description = "AWS Transcribe language code"
  type        = string
  default     = "en-US"
}

variable "max_acp_sessions" {
  description = "Maximum concurrent ACP sessions"
  type        = number
  default     = 10
}

variable "volume_size" {
  description = "Root EBS volume size in GB"
  type        = number
  default     = 20
}

variable "app_name" {
  description = "Application name (used for tagging and naming)"
  type        = string
  default     = "voice-agent-studio"
}
