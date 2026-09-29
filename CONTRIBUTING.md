# Contributing

Thanks for helping improve Forja.

## Issues

Open an issue for bugs, documentation problems, or focused feature proposals. Include the expected behavior, actual behavior, reproduction steps, and relevant logs with secrets removed.

## Pull requests

1. Create a focused branch.
2. Keep changes scoped to one topic.
3. Run `pnpm typecheck` and `pnpm test` when possible.
4. Review the complete diff before opening the pull request.
5. Never commit API keys, tokens, customer data, or member-specific secrets.

## Repository rules

- Do not modify `member/` unless the task explicitly requires a member customization.
- Keep channel contracts, database schema, and environment variable names backward compatible.
- Use `wrangler secret put` for secrets.
- Add or update tests for behavior changes.

## License

By contributing, you agree that your work is licensed under the MIT license.
