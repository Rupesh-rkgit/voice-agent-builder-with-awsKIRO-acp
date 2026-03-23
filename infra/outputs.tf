# =============================================================================
# Outputs — Voice Agent Studio EC2 Deployment
# =============================================================================

output "instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.app.id
}

output "public_ip" {
  description = "Public IP of the EC2 instance"
  value       = aws_instance.app.public_ip
}

output "http_url" {
  description = "HTTP URL (no browser warning)"
  value       = "http://${aws_instance.app.public_ip}"
}

output "https_url" {
  description = "HTTPS URL (self-signed cert — browser warning expected)"
  value       = "https://${aws_instance.app.public_ip}"
}

output "ssh_command" {
  description = "SSH command to connect to the instance"
  value       = var.key_pair_name != "" ? "ssh -i ${var.key_pair_name}.pem ec2-user@${aws_instance.app.public_ip}" : "No key pair configured — use EC2 Instance Connect or SSM"
}

output "cloud_init_log_command" {
  description = "Command to check deployment progress after SSH"
  value       = "tail -f /var/log/cloud-init-output.log"
}

output "app_status_command" {
  description = "Command to check app status after SSH"
  value       = "pm2 status && sudo systemctl status caddy"
}

output "deployment_note" {
  description = "Important: UserData takes ~5 minutes to complete after instance launch"
  value       = "⏳ Wait ~5 minutes after 'terraform apply' for the app to finish deploying. Check progress with: ssh into instance → tail -f /var/log/cloud-init-output.log"
}
