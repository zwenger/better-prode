## Summary

<!-- What does this PR do? One or two sentences focused on the outcome. -->

## Related issue

<!-- Closes #<issue-number> — or "N/A" if there is no tracking issue. -->

## Type of change

- [ ] Bug fix (`fix:`)
- [ ] New feature (`feat:`)
- [ ] Refactor (`refactor:`)
- [ ] Tests only (`test:`)
- [ ] Docs / comments (`docs:`)
- [ ] Chore / tooling (`chore:`, `ci:`)

## What to review first

<!-- Point reviewers at the most important file or logic change so they don't have to reconstruct the story. -->

## Testing done

<!-- Describe what you tested and how. Include test commands you ran. -->

```bash
npm test
npm run test:workers
npm run typecheck
npm run lint
```

## Checklist

- [ ] Tests added or updated for the changed behavior
- [ ] All CI checks pass locally (`npm run lint && npm run typecheck && npm test && npm run build`)
- [ ] Commits follow Conventional Commits (`feat:`, `fix:`, `chore:`, etc.)
- [ ] No `Co-Authored-By` AI attribution lines in commits
- [ ] `openspec/` updated if the domain model or a spec was affected
