# Models

## UVDoc

`uvdoc.onnx` is an ONNX export of [UVDoc](https://github.com/tanguymagne/UVDoc)
(Tanguy Magne et al., MIT License), used for automatic dewarping of document photos.

Create it with:

```sh
bun run setup:uvdoc
```

Input: `1×3×712×488` RGB float in `[0, 1]`. Output `grid`: `1×2×45×31` sampling positions in `[-1, 1]`
(x plane, then y plane), applied with `src/shared/image/unwarp.ts`.

## Document segmentation

`docseg.onnx` is an ONNX export of the DeepLabV3 (MobileNetV3-Large) document segmentation model from LearnOpenCV's
[Document Scanner: Semantic Segmentation using PyTorch-DeepLabV3](https://learnopencv.com/deep-learning-based-document-segmentation-using-semantic-segmentation-deeplabv3-on-custom-dataset/)
([code](https://github.com/spmallick/learnopencv/tree/master/Document-Scanner-Custom-Semantic-Segmentation-using-PyTorch-DeepLabV3)),
used for „Auto-Zuschnitt“.

Create it with:

```sh
bun run setup:docseg
```

Input: `1×3×384×384` RGB, `(v / 255 - mean) / std` with mean `(0.4611, 0.4359, 0.3905)` and std
`(0.2193, 0.2150, 0.2109)`. Output `logits`: `1×2×384×384` (background, document), turned into a mask by
`src/server/services/documentSegmentation.ts` and into corners by `quadFromMask` (`src/shared/image/autoCrop.ts`).
