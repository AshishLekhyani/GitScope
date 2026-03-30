import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";

export type NotificationType = "info" | "warning" | "error" | "success";

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  isRead: boolean;
  link?: string;
  createdAt: string;
  source: "gitscope" | "github";
}

export function useNotifications() {
  const { data: session } = useSession();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    if (!session?.user) return;
    
    try {
      const res = await fetch("/api/user/notifications", { cache: "no-store" });
      if (res.ok) {
        const data: NotificationItem[] = await res.json();
        setNotifications(data);
        setUnreadCount(data.filter(n => !n.isRead).length);
      }
    } catch (e) {
      console.error("Failed to fetch notifications", e);
    } finally {
      setLoading(false);
    }
  }, [session?.user]);

  const markAsRead = async (id: string) => {
    try {
      const res = await fetch("/api/user/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });

      if (res.ok) {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (e) {
      console.error("Failed to mark as read", e);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 180000); // Polling every 3 mins
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  return { 
    notifications, 
    unreadCount, 
    loading, 
    markAsRead, 
    refresh: fetchNotifications 
  };
}
// useNotifications v1
