# Models

`uvdoc.onnx` is an ONNX export of [UVDoc](https://github.com/tanguymagne/UVDoc)
(Tanguy Magne et al., MIT License), used for automatic dewarping of document photos.

Create it with:

```sh
bun run setup:uvdoc
```

Input: `1×3×712×488` RGB float in `[0, 1]`. Output `grid`: `1×2×45×31` sampling positions in `[-1, 1]`
(x plane, then y plane), applied with `src/shared/image/unwarp.ts`.
