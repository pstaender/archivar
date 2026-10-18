import { Camera, Loader, Upload } from "../icons";
import { useRef } from "react";
import { uploadAccept } from "../../shared/uploads";
import { useConfig } from "../hooks/config";
import { useUpload } from "../hooks/upload";
import { useTranslation } from "react-i18next";

export function UploadButtons() {
  const { progress, uploadToCurrentTarget } = useUpload();
  const { t } = useTranslation();
  const { convertibleImageTypes } = useConfig();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const onFiles = (input: HTMLInputElement | null) => {
    const files = Array.from(input?.files ?? []);
    if (input) input.value = "";
    void uploadToCurrentTarget(files);
  };

  return (
    <div className="upload-buttons">
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={uploadAccept(convertibleImageTypes)}
        hidden
        data-testid="file-input"
        onChange={(e) => onFiles(e.currentTarget)}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-testid="camera-input"
        onChange={(e) => onFiles(e.currentTarget)}
      />
      <button type="button" className="btn btn--icon camera-button" onClick={() => cameraInput.current?.click()} aria-label={t("upload.takePhoto")} title={t("upload.takePhoto")}>
        <Camera size={18} />
      </button>
      <button type="button" className="btn btn--primary" onClick={() => fileInput.current?.click()}>
        {progress ? <Loader size={16} className="spin" /> : <Upload size={16} />}
        <span className="hide-mobile">{t("upload.upload")}</span>
      </button>
    </div>
  );
}
