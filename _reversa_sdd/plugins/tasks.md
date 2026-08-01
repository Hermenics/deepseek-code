# Plugins — implementation tasks

- [ ] T-01 Validate sources, manifests, and safe names.
  - Origin: `src/plugins/`
  - Done when: unsafe source/layout cannot reach installation.
  - Confidence: 🟢
- [ ] T-02 Implement clone, registry, removal, update backup/restore.
  - Origin: `src/plugins/`
  - Done when: update failure preserves the old install.
  - Confidence: 🟢

## Tests

- [ ] TT-01 Valid root/monorepo install.
- [ ] TT-02 Duplicate/invalid/update-rollback paths.
