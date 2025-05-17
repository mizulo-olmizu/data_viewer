// ファイルを選択するためのコンポーネント
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { Stack, Box, Button } from "@mui/material";
import { open } from "@tauri-apps/plugin-dialog";

export interface FileInputProps {
  filePath: string;
  onChange?: (filename: string) => void;
  onCancelled?: () => void;
  onError?: (error: unknown) => void;
  fileType?: "csv";
  description?: string;
}

export default function FileInput({
  filePath,
  onChange = () => {},
  onCancelled = () => {},
  onError = () => {},
  fileType,
}: FileInputProps) {
  const filters =
    fileType === undefined
      ? undefined
      : [{ name: "*", extensions: [fileType] }];

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
      <Box
        whiteSpace="nowrap"
        overflow="hidden"
        textAlign="left"
        color={fileSelected ? undefined : "text.disabled"}
      >
        {fileSelected ? filePath : "ファイルが選択されていません"}
      </Box>
    </Stack>
  );
}
