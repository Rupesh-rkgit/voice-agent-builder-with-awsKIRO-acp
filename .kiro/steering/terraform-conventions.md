# Terraform Conventions

## File Structure
```
envs/
  dev/
  staging/
  prod/
modules/
  networking/
  compute/
  database/
```

## Naming
- Resources: snake_case (e.g. `aws_s3_bucket.app_assets`)
- Variables: snake_case, descriptive (e.g. `vpc_cidr_block`)
- Modules: kebab-case directories (e.g. `modules/api-gateway/`)
- Files: `main.tf`, `variables.tf`, `outputs.tf`, `providers.tf`, `backend.tf`

## State
- Remote backend: S3 + DynamoDB locking
- One state file per environment
- Never modify state manually — use `terraform state` commands

## Best Practices
- Pin provider versions: `~> 5.0`
- Pin module versions in source refs
- Use `terraform plan -out=plan.tfplan` before apply
- Tag all resources: `project`, `environment`, `owner`
- Use `prevent_destroy` lifecycle on stateful resources (RDS, S3)
- Validate with `terraform validate` and `tflint`
- No hardcoded values — use variables with sensible defaults