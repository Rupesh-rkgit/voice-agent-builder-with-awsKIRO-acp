# CDK Conventions

## General
- Use CDK v2 (`aws-cdk-lib`) exclusively — no v1 imports
- TypeScript only
- Use L2 constructs over L1 (Cfn*) unless L2 doesn't exist
- One stack per file, named `*-stack.ts`

## Naming
- Stack classes: PascalCase ending in `Stack` (e.g. `PipelineStack`)
- Construct IDs: PascalCase, descriptive (e.g. `ProductionStage`)
- File names: kebab-case (e.g. `pipeline-stack.ts`)
- Resource names: use `cdk.Names.uniqueId()` or let CDK auto-name

## Structure
```
lib/
  stacks/         # Stack definitions
  stages/         # Pipeline stages
  constructs/     # Reusable L3 constructs
bin/              # App entry point
```

## Best Practices
- Always pass `env` to stacks that use region-specific features
- Use `RemovalPolicy.RETAIN` for stateful resources in production
- Tag all resources with `project`, `environment`, and `owner`
- Use `CfnOutput` for values needed by other stacks
- Keep construct trees shallow — max 3 levels of nesting
- Use `Aspects` for cross-cutting concerns (tagging, compliance)