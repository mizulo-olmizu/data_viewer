import { TbTablePlus } from "react-icons/tb";

export default function EmptyData() {
  return (
    <div className="flex flex-col gap-1 items-center">
      <TbTablePlus className="w-48 h-48 text-[#bbb]" />
      <h2 className="font-bold mt-0 text-[#bbb]">No Data!</h2>
      <p className="text-[#bbb] mt-0">
        By adding data, you can view its preview and summary.
      </p>
    </div>
  );
}
