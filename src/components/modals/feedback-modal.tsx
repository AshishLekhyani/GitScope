"use client";

import { useState } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

type FeedbackCategory = "bug" | "feature" | "improvement" | "other";

export function FeedbackModal({ 
  open, 
  onOpenChange 
}: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void 
}) {
  const [category, setCategory] = useState<FeedbackCategory>("improvement");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async () => {
    if (!message.trim()) return;
    
    setIsSubmitting(true);
    // Simulate API call
    await new Promise(r => setTimeout(r, 1500));
    setIsSubmitting(false);
    setIsSuccess(true);
    
    // Auto-close after success
    setTimeout(() => {
      onOpenChange(false);
      // Reset after animation
      setTimeout(() => {
        setIsSuccess(false);
        setMessage("");
      }, 500);
    }, 2000);
  };

  const categories: { id: FeedbackCategory, label: string, icon: string }[] = [
    { id: "bug", label: "Bug Report", icon: "bug_report" },
    { id: "feature", label: "New Feature", icon: "rocket_launch" },
    { id: "improvement", label: "Improvement", icon: "auto_awesome" },
    { id: "other", label: "Other", icon: "more_horiz" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-[480px] p-0 overflow-hidden border border-white/10 bg-stone-900/95 backdrop-blur-xl max-h-[90vh] overflow-y-auto">
        <AnimatePresence mode="wait">
          {!isSuccess ? (
            <motion.div
              key="form"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="p-6"
            >
              <DialogHeader className="mb-4 sm:mb-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="size-10 rounded-none bg-amber-500/20 flex items-center justify-center shrink-0">
                    <MaterialIcon name="chat_bubble" className="text-amber-400" size={22} />
                  </div>
                  <div className="min-w-0">
                    <DialogTitle className="text-lg sm:text-xl font-bold tracking-tight text-white font-heading">
                      Help Us Evolve
                    </DialogTitle>
                    <DialogDescription className="text-stone-400 text-xs sm:text-sm">
                      Your feedback directly shapes the future of GitScope.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-4 sm:space-y-6">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-stone-500 mb-2 sm:mb-3 block">
                    Category
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {categories.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setCategory(c.id)}
                        className={cn(
                          "flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-none border text-xs sm:text-sm font-semibold transition-all text-left",
                          category === c.id 
                            ? "bg-amber-500/10 border-amber-500/50 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.1)]" 
                            : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/60 hover:border-border"
                        )}
                      >
                        <MaterialIcon name={c.icon} size={16} className={cn(category === c.id ? "text-amber-400" : "text-stone-500")} />
                        <span className="truncate">{c.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-stone-500 mb-2 sm:mb-3 block">
                    Your Insight
                  </label>
                  <Textarea
                    placeholder="Tell us what's on your mind..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="min-h-[100px] sm:min-h-[120px] bg-muted/30 border-border focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 resize-none text-sm"
                  />
                </div>
              </div>

              <DialogFooter className="mt-6 sm:mt-8 border-t border-white/10 pt-4 sm:pt-6 flex-col sm:flex-row gap-2">
                <Button 
                  variant="ghost" 
                  onClick={() => onOpenChange(false)}
                  className="text-stone-400 hover:text-white w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleSubmit} 
                  disabled={isSubmitting || !message.trim()}
                  className="bg-amber-600 hover:bg-amber-500 text-white min-w-[120px] transition-all active:scale-[0.98] w-full sm:w-auto"
                >
                  {isSubmitting ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                      className="size-4 border-2 border-white/20 border-t-white rounded-full"
                    />
                  ) : "Ship Feedback"}
                </Button>
              </DialogFooter>
            </motion.div>
          ) : (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-6 sm:p-12 text-center"
            >
              <div className="size-12 sm:size-16 bg-emerald-500/20 rounded-none flex items-center justify-center mx-auto mb-4 sm:mb-6">
                <MaterialIcon name="verified" className="text-emerald-400" size={24} />
              </div>
              <h3 className="text-xl sm:text-2xl font-heading font-black text-white mb-2 tracking-tight">Received!</h3>
              <p className="text-stone-400 text-sm">Our engineering team has intercepted your transmission.</p>
              <p className="text-[10px] uppercase font-black tracking-widest text-emerald-400/50 mt-6 sm:mt-8">Transmitting Data... 100%</p>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
// FeedbackModal v1
