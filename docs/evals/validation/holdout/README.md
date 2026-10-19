<!-- Held out. Builders and agents must not open, print or read anything in this folder. -->
# The validation's held-out records

This folder holds what the validation reports on its held-out test split: arm
A's results (`arm-a-test.json`, `arm-a-test.md`) and, at the freeze, the
reported runs. Builders and agents must not open, print or read anything in it,
as for the test split's definitions (`src/nebula3d/validation/holdout/`).
`python -m nebula3d.validation arm-a --split test --report` writes only here.
The held-out scan (`tests/test_validation.py`) allows test-split values in this
folder and nowhere else in the docs.
