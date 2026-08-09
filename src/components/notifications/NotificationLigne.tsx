"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { marquerNotificationLue } from "@/actions/notifications";
import type { Notification } from "@/lib/types";

export function NotificationLigne({ notification }: { notification: Notification }) {
  const router = useRouter();

  async function onClick() {
    if (!notification.lu) {
      await marquerNotificationLue(notification.id);
      router.refresh();
    }
  }

  const contenu = (
    <div
      className={clsx(
        "flex items-start justify-between gap-3 rounded-xl border px-4 py-3",
        notification.lu ? "border-gray-100 bg-white" : "border-primary-100 bg-primary-50/40"
      )}
    >
      <div>
        <p className={clsx("text-sm", notification.lu ? "text-gray-700" : "font-medium text-gray-900")}>{notification.titre}</p>
        {notification.message && <p className="mt-0.5 text-xs text-gray-500">{notification.message}</p>}
        <p className="mt-1 text-xs text-gray-400">{new Date(notification.created_at).toLocaleString("fr-FR")}</p>
      </div>
      {!notification.lu && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary-600" />}
    </div>
  );

  if (notification.lien) {
    return (
      <Link href={notification.lien} onClick={onClick}>
        {contenu}
      </Link>
    );
  }

  return (
    <button onClick={onClick} className="w-full text-left">
      {contenu}
    </button>
  );
}
