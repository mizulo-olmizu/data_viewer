// ファイルを選択するためのコンポーネント
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { Stack, Button } from "@mui/material";
import { open } from "@tauri-apps/plugin-dialog";
import TypographyTruncate from "./TypographyTruncate";

export interface FileInputProps {
  filePath: string;
  onChange?: (filename: string) => void;
  onCancelled?: () => void;
  onError?: (error: unknown) => void;
  fileTypes?: string[];
  description?: string;
}

export default function FileInput({
  filePath,
  onChange = () => {},
  onCancelled = () => {},
  onError = () => {},
  fileTypes,
}: FileInputProps) {
  const filters =
    fileTypes === undefined
      ? undefined
      : [{ name: "*", extensions: fileTypes }];

  const fileSelect = () => {
    open({
      multiple: false,
      filters,
    })
      .then((file) => {
        if (typeof file === "string") {
          onChange(file);
        } else if (file === null) {
          onCancelled();
        }
      })
      .catch((error) => {
        onError(error);
      });
  };

  const fileSelected = filePath !== "";

  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Button onClick={fileSelect} startIcon={<CloudUploadIcon />}>
        ファイル選択
      </Button>
      <TypographyTruncate color={fileSelected ? undefined : "text.disabled"}>
        {fileSelected ? filePath : "ファイルが選択されていません"}
      </TypographyTruncate>
    </Stack>
  );
}
