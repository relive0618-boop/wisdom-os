import { listCloudEntity, saveCloudEntity } from "@/lib/cloud/server";
export const GET = () => listCloudEntity("pdca");
export const POST = (request: Request) => saveCloudEntity(request, "pdca");
