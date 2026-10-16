import type { SVGProps } from "react";
import { type IconData, keyline } from "./keyline" with { type: "macro" };

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "dangerouslySetInnerHTML"> {
  size?: number;
  strokeWidth?: number;
}

function createIcon(data: IconData, name: string) {
  function Icon({ size = 24, strokeWidth, className, ...props }: IconProps) {
    const body = strokeWidth === undefined ? data.body : data.body.replaceAll(/stroke-width="[^"]*"/g, `stroke-width="${strokeWidth}"`);
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={data.viewBox}
        width={size}
        height={size}
        aria-hidden={props["aria-label"] ? undefined : true}
        focusable="false"
        className={className ? `icon ${className}` : "icon"}
        dangerouslySetInnerHTML={{ __html: body }}
        {...props}
      />
    );
  }
  Icon.displayName = name;
  return Icon;
}

export const ArrowLeft = createIcon(keyline("arrow-left"), "ArrowLeft");
export const Camera = createIcon(keyline("camera"), "Camera");
export const Check = createIcon(keyline("check"), "Check");
export const ChevronLeft = createIcon(keyline("chevron-left"), "ChevronLeft");
export const ChevronRight = createIcon(keyline("chevron-right"), "ChevronRight");
export const CircleAlert = createIcon(keyline("circle-alert"), "CircleAlert");
export const CircleCheck = createIcon(keyline("circle-check"), "CircleCheck");
export const Contrast = createIcon(keyline("circle-half"), "Contrast");
export const Copy = createIcon(keyline("copy"), "Copy");
export const Crop = createIcon(keyline("frame"), "Crop");
export const Download = createIcon(keyline("download"), "Download");
export const Eraser = createIcon(keyline("eraser-sparkles"), "Eraser");
export const ExternalLink = createIcon(keyline("square-arrow-up-right"), "ExternalLink");
export const FileText = createIcon(keyline("file-text"), "FileText");
export const Folder = createIcon(keyline("folder"), "Folder");
export const FolderOpen = createIcon(keyline("folder-open"), "FolderOpen");
export const FolderPlus = createIcon(keyline("folder-plus"), "FolderPlus");
export const ImagePlus = createIcon(keyline("image-plus"), "ImagePlus");
export const Inbox = createIcon(keyline("inbox"), "Inbox");
export const Layers = createIcon(keyline("layers"), "Layers");
export const Loader = createIcon(keyline("loader-circle"), "Loader");
export const Maximize = createIcon(keyline("maximize"), "Maximize");
export const Menu = createIcon(keyline("menu"), "Menu");
export const CircleMinus = createIcon(keyline("circle-minus"), "CircleMinus");
export const Pencil = createIcon(keyline("square-pen"), "Pencil");
export const Plus = createIcon(keyline("plus"), "Plus");
export const RotateCcw = createIcon(keyline("rotate-ccw"), "RotateCcw");
export const RotateCw = createIcon(keyline("rotate-cw"), "RotateCw");
export const Scan = createIcon(keyline("scan"), "Scan");
export const ScanText = createIcon(keyline("scan-text"), "ScanText");
export const Search = createIcon(keyline("search"), "Search");
export const Trash = createIcon(keyline("bin"), "Trash");
export const TriangleAlert = createIcon(keyline("triangle-alert"), "TriangleAlert");
export const Unlink = createIcon(keyline("unlink"), "Unlink");
export const Upload = createIcon(keyline("upload"), "Upload");
export const WandSparkles = createIcon(keyline("wand-sparkles"), "WandSparkles");
export const X = createIcon(keyline("x"), "X");
export const ZoomIn = createIcon(keyline("search-plus"), "ZoomIn");
export const ZoomOut = createIcon(keyline("search-minus"), "ZoomOut");
