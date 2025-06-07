import CloseIcon from "@mui/icons-material/Close";
import ErrorIcon from "@mui/icons-material/Error";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Button,
} from "@mui/material";

export interface ErrorModalProps {
  open: boolean;
  onClose?: () => void;
  message: string;
  detailMessage?: string;
}

export function ErrorModal({
  open,
  onClose,
  message,
  detailMessage,
}: ErrorModalProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="alert-dialog-title"
      aria-describedby="alert-dialog-description"
    >
      <DialogTitle id="alert-dialog-title" sx={{ color: "error.main" }}>
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <ErrorIcon fontSize="large" sx={{ mr: 1 }} />
          エラーが発生しました
        </Box>
      </DialogTitle>
      <Divider />
      <DialogContent>
        <DialogContentText id="alert-dialog-description">
          {message}
        </DialogContentText>
        {detailMessage && (
          <Accordion sx={{ fontSize: "small" }}>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              aria-controls="panel1-content"
              id="panel1-header"
              sx={{ mt: 2 }}
            >
              詳細
            </AccordionSummary>
            <AccordionDetails
              sx={{
                maxHeight: "160px",
                width: "500px",
                overflow: "scroll",
                whiteSpace: "pre-wrap",
              }}
            >
              {detailMessage}
            </AccordionDetails>
          </Accordion>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: "center", mb: 1 }}>
        <Button
          onClick={onClose}
          autoFocus
          startIcon={<CloseIcon />}
          variant="outlined"
          color="error"
        >
          閉じる
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default ErrorModal;
