import { describe, expect, it } from 'bun:test'
import { assessRisk, hasImplicitCloudMutationTarget, hasNetworkCapability } from '../src/permissions/risk.js'
import type { RiskContext } from '../src/permissions/types.js'

const context = (enabled = true): RiskContext => ({ isSubAgent: false, recentWriteCount: 0, config: { enabled } })

describe('implicit cloud mutation target risk', () => {
  const ambiguousCommands = [
    'aws ec2 terminate-instances',
    'gcloud compute instances delete',
    'az group delete',
    'kubectl delete pods',
    'terraform apply',
    'pulumi up',
  ]

  for (const command of ambiguousCommands) {
    it(`requires high-risk confirmation for ${command}`, () => {
      expect(hasImplicitCloudMutationTarget(command)).toBe(true)
      expect(hasNetworkCapability('shell', { command })).toBe(true)
      expect(assessRisk('shell', { command }, context(false))).toMatchObject({
        level: 'high',
        matchedRule: 'shell:cloud-target-implicit',
        requiresConfirmation: true,
      })
    })
  }

  it('accepts literal provider context selectors and provider-qualified resource IDs', () => {
    const explicitlyTargetedCommands = [
      'aws --profile production ec2 terminate-instances --instance-ids i-123',
      'aws --region us-east-1 ec2 terminate-instances --instance-ids i-123',
      'AWS_PROFILE=production aws ec2 terminate-instances --instance-ids i-123',
      'gcloud --project production compute instances delete api-1',
      'gcloud compute instances delete projects/production/zones/us-central1-a/instances/api-1',
      'az group delete --name production --subscription sub-123',
      'az resource delete --ids /subscriptions/12345678-1234-1234-1234-123456789012/resourceGroups/prod/providers/Microsoft.Compute/virtualMachines/api',
      'kubectl --context production -n app delete pod api-1',
      'kubectl --server=https://cluster.example -n app delete pod api-1',
      'pulumi up --stack production',
      'aws cloudformation delete-stack --stack-name arn:aws:cloudformation:us-east-1:123456789012:stack/prod/id',
    ]

    for (const command of explicitlyTargetedCommands) {
      expect(hasImplicitCloudMutationTarget(command), command).toBe(false)
      expect(hasNetworkCapability('shell', { command }), command).toBe(true)
      expect(assessRisk('shell', { command }, context(false))).toMatchObject({
        level: 'high',
        matchedRule: 'shell:network',
        requiresConfirmation: true,
      })
    }
  })

  it('keeps ambient identity and location risk when only a resource name or ID is supplied', () => {
    const commands = [
      'aws ec2 terminate-instances --instance-ids i-123',
      'aws s3 rm s3://production-logs/old.log',
      'gcloud compute instances delete api-1',
      'az group delete --name production --resource-group rg-production',
      'kubectl -n production delete pod api-1',
      'terraform apply -target=aws_instance.api',
    ]

    for (const command of commands) {
      expect(hasImplicitCloudMutationTarget(command), command).toBe(true)
      const assessment = assessRisk('shell', { command }, context(false))
      expect(assessment, command).toMatchObject({
        level: 'high',
        matchedRule: 'shell:cloud-target-implicit',
        requiresConfirmation: true,
      })
      expect(assessment?.description, command).toContain('does not verify the active identity or deployment plan')
    }
  })

  it('does not treat computed selector values as parseable destinations', () => {
    const command = 'gcloud compute instances delete --project "$PROJECT"'
    expect(hasImplicitCloudMutationTarget(command)).toBe(true)
    expect(assessRisk('shell', { command }, context())).toMatchObject({
      level: 'high',
      matchedRule: 'shell:cloud-target-implicit',
      requiresConfirmation: true,
    })
  })

  it('checks each shell segment independently instead of borrowing a later command selector', () => {
    const command = 'gcloud compute instances delete; aws --region us-east-1 ec2 describe-instances'
    expect(hasImplicitCloudMutationTarget(command)).toBe(true)
    expect(assessRisk('shell', { command }, context())).toMatchObject({
      level: 'high',
      matchedRule: 'shell:cloud-target-implicit',
      requiresConfirmation: true,
    })
  })

  it('does not classify read-only cloud commands or cloud text passed to another command as mutations', () => {
    for (const command of [
      'aws sts get-caller-identity',
      'gcloud compute instances list',
      'az group show --name production',
      'kubectl get pods',
      'terraform plan',
      'printf "%s" "aws ec2 terminate-instances"',
    ]) {
      expect(hasImplicitCloudMutationTarget(command), command).toBe(false)
      expect(hasNetworkCapability('shell', { command }), command).toBe(false)
      expect(assessRisk('shell', { command }, context()), command).toBeNull()
    }
  })

  it('finds a cloud mutation inside supported shell control flow', () => {
    const command = 'if true; then kubectl delete pods; fi'
    expect(hasImplicitCloudMutationTarget(command)).toBe(true)
    expect(assessRisk('shell', { command }, context())).toMatchObject({
      level: 'high',
      matchedRule: 'shell:cloud-target-implicit',
      requiresConfirmation: true,
    })
  })
})
