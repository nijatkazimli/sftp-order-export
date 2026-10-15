import type { ActionFunctionArgs } from "react-router";
import { handleOrderWebhook } from "../services/orderWebhook.server";

export const action = ({ request }: ActionFunctionArgs) =>
  handleOrderWebhook(request, "created");
