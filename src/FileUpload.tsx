import UploadFileIcon from "@mui/icons-material/UploadFile";
import Box from "@mui/material/Box";

export interface FileUploadProps {
  color: string;
  backgroundColor: string;
}

export default function FileUpload({
  color,
  backgroundColor,
}: FileUploadProps) {
  return (
    <Box
      sx={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor,
        zIndex: 9999, // 他の要素より前面に表示
      }}
    >
      {/* 四角の破線枠 */}
      <Box
        sx={{
          position: "absolute",
          top: "20%",
          left: "20%",
          width: "60%",
          height: "60%",
          borderRadius: "8px", // 角を少し丸くする
          backgroundImage: `
            repeating-linear-gradient(0deg, ${color}, ${color} 10px, transparent 10px, transparent 20px, ${color} 20px),
            repeating-linear-gradient(90deg, ${color}, ${color} 10px, transparent 10px, transparent 20px, ${color} 20px),
            repeating-linear-gradient(180deg, ${color}, ${color} 10px, transparent 10px, transparent 20px, ${color} 20px),
            repeating-linear-gradient(270deg, ${color}, ${color} 10px, transparent 10px, transparent 20px, ${color} 20px)
          `,
          backgroundSize: `
            3px calc(100% + 20px),
            calc(100% + 20px) 3px,
            3px calc(100% + 20px),
            calc(100% + 20px) 3px
          `,
          backgroundPosition: `
            0 0,
            0 0,
            100% 0,
            0 100%
          `,
          backgroundRepeat: "no-repeat",
          animation: "borderAnimation 0.5s infinite linear", // 枠のアニメーション
        }}
      />
      <UploadFileIcon
        sx={{
          fontSize: 80,
          color,
          zIndex: 10000, // アイコンを枠の上に表示
        }}
      />
      {/* CSSアニメーション */}
      <style>
        {`
          @keyframes borderAnimation {
            from {
              background-position: 0 0, -20px 0, 100% -20px, 0 100%;
            }
            to {
              background-position: 0 -20px, 0 0, 100% 0, -20px 100%;
            }
          }
        `}
      </style>
    </Box>
  );
}
