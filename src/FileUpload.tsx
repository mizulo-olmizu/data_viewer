import { LuUpload } from "react-icons/lu";

export default function FileUpload() {
  return (
    // TODO 色を修正
    <div className="fixed inset-0 flex items-center justify-center z-[9999] bg-gray-50 dark:bg-gray-800">
      <div className="absolute top-[20%] left-[20%] w-[60%] h-[60%] rounded-lg border-4 border-dashed border-blue-600 dark:border-amber-400" />
      <LuUpload className="z-10 text-blue-600 dark:text-amber-400 animate-ping w-20 h-20" />
    </div>
  );
}
