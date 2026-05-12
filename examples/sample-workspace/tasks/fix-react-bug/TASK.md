# fix-react-bug

Task:
Fix a stale state bug in `Counter.tsx` where the `+2` button only increments by 1.

Current broken code pattern:
```tsx
const onPlusTwo = () => {
  setCount(count + 1);
  setCount(count + 1);
};
```

Required implementation:
- Update `onPlusTwo` to use functional state updates so each increment is applied.
- Keep existing component API unchanged (`Counter` props and rendered markup).
- Do not introduce new dependencies.

Verification steps:
- Run `npm test`.
- Add/update a test that clicks `+2` once and expects displayed count to increase from `0` to `2`.
- Add/update a test that clicks `+2` twice and expects `4`.

Expected outcome:
- `+2` button increments exactly by 2 per click.
- All tests pass deterministically in repeated runs.

