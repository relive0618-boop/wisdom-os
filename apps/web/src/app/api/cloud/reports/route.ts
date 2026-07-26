import { listCloudEntity, saveCloudEntity } from "@/lib/cloud/server";
export const GET = () => listCloudEntity("reports");
export const POST = (request: Request) => saveCloudEntity(request, "reports");
