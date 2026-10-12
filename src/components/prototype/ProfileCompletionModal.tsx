import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  User, 
  Phone, 
  Mail, 
  Calendar, 
  MapPin, 
  ShieldCheck, 
  AlertCircle, 
  CheckCircle2, 
  Lock,
  ArrowRight,
  LogOut
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useTranslation } from "../../translation/useTranslation";

interface ProfileCompletionModalProps {
  isOpen: boolean;
  currentUser: any;
  initialProfile?: any;
  onSuccess: (updatedProfile: any) => void;
  onSignOut: () => void;
}

export const ProfileCompletionModal: React.FC<ProfileCompletionModalProps> = ({
  isOpen,
  currentUser,
  initialProfile,
  onSuccess,
  onSignOut,
}) => {
  const { t } = useTranslation();

  // Form field states
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [dob, setDob] = useState("");
  const [address, setAddress] = useState("");

  // Validation & Submission states
  const [errors, setErrors] = useState<{ name?: string; phone?: string; email?: string; dob?: string }>({});
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shakeTrigger, setShakeTrigger] = useState(0);
  const [backdropClickNotice, setBackdropClickNotice] = useState(false);

  // Pre-fill inputs when component receives user or initial profile
  useEffect(() => {
    if (currentUser || initialProfile) {
      const initialName = 
        initialProfile?.name || 
        initialProfile?.full_name || 
        currentUser?.user_metadata?.full_name || 
        currentUser?.user_metadata?.name || 
        "";
      
      const initialPhone = 
        initialProfile?.phone || 
        initialProfile?.phone_number || 
        currentUser?.user_metadata?.phone || 
        currentUser?.user_metadata?.phone_number || 
        "";

      const initialEmail = 
        initialProfile?.email || 
        currentUser?.email || 
        "";

      const initialDob = 
        initialProfile?.dob ? String(initialProfile.dob).substring(0, 10) : "";

      const initialAddress = 
        initialProfile?.address || 
        "";

      setName(initialName);
      setPhone(initialPhone);
      setEmail(initialEmail);
      setDob(initialDob);
      setAddress(initialAddress);
    }
  }, [currentUser, initialProfile]);

  // Intercept and prevent Escape key bypass
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        triggerBypassPreventionNotice();
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [isOpen]);

  const triggerBypassPreventionNotice = () => {
    setShakeTrigger((prev) => prev + 1);
    setBackdropClickNotice(true);
    setTimeout(() => {
      setBackdropClickNotice(false);
    }, 3200);
  };

  // Client-side phone format validation: at least 7 digits, allowed phone formatting characters
  const validatePhone = (phoneNumber: string): boolean => {
    const digitsOnly = phoneNumber.replace(/\D/g, "");
    if (digitsOnly.length < 7 || digitsOnly.length > 16) {
      return false;
    }
    // Accept standard international or regional phone formats e.g. +91 94401 23456, 9440123456
    const phoneRegex = /^(\+?[0-9\s\-().]{7,20})$/;
    return phoneRegex.test(phoneNumber.trim());
  };

  // Client-side email format validation (optional field, but if filled must be valid)
  const validateEmail = (emailStr: string): boolean => {
    if (!emailStr.trim()) return true;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(emailStr.trim());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError("");
    const newErrors: { name?: string; phone?: string; email?: string; dob?: string } = {};

    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim();
    const trimmedAddress = address.trim();

    // 1. Validate Name (Compulsory)
    if (!trimmedName) {
      newErrors.name = t("profile_modal.name_required", "Full name is compulsory to proceed.");
    } else if (trimmedName.length < 2) {
      newErrors.name = t("profile_modal.name_too_short", "Name must be at least 2 characters long.");
    }

    // 2. Validate Phone (Compulsory)
    if (!trimmedPhone) {
      newErrors.phone = t("profile_modal.phone_required", "Phone number is compulsory to proceed.");
    } else if (!validatePhone(trimmedPhone)) {
      newErrors.phone = t("profile_modal.phone_invalid", "Please provide a valid phone number (e.g. +91 94401 23456).");
    }

    // 3. Validate Optional Email
    if (trimmedEmail && !validateEmail(trimmedEmail)) {
      newErrors.email = t("profile_modal.email_invalid", "Please provide a valid email address.");
    }

    // 4. Validate Optional Date of Birth
    if (dob) {
      const selectedDate = new Date(dob);
      const today = new Date();
      if (selectedDate > today) {
        newErrors.dob = t("profile_modal.dob_future", "Date of birth cannot be in the future.");
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setShakeTrigger((prev) => prev + 1);
      return;
    }

    setErrors({});
    setIsSubmitting(true);

    try {
      if (!currentUser?.id) {
        throw new Error("No active user session detected. Please sign in again.");
      }

      // Safe update payload containing required name & phone, and optional fields
      const profilePayload: Record<string, any> = {
        id: currentUser.id,
        name: trimmedName,
        full_name: trimmedName, // sync both name and full_name for backwards compatibility
        phone: trimmedPhone,
        phone_number: trimmedPhone, // sync both phone and phone_number for backwards compatibility
        email: trimmedEmail || currentUser.email || null,
        dob: dob ? dob : null,
        address: trimmedAddress || null,
        updated_at: new Date().toISOString()
      };

      // Preserve existing profile metadata if available
      if (initialProfile) {
        if (initialProfile.user_role) profilePayload.user_role = initialProfile.user_role;
        if (initialProfile.preferred_language) profilePayload.preferred_language = initialProfile.preferred_language;
        if (initialProfile.district) profilePayload.district = initialProfile.district;
        if (initialProfile.state) profilePayload.state = initialProfile.state;
        if (initialProfile.village) profilePayload.village = initialProfile.village;
        if (initialProfile.organization_name) profilePayload.organization_name = initialProfile.organization_name;
      }

      // Upsert into public.profiles with adaptive fallback for unmigrated columns in schema cache
      let currentPayload: Record<string, any> = { ...profilePayload };
      let savedData: any = null;
      let lastError: any = null;

      // Iteratively strip any columns missing in the remote Supabase schema cache
      for (let attempt = 0; attempt < 8; attempt++) {
        const { data, error } = await supabase
          .from("profiles")
          .upsert(currentPayload, { onConflict: "id" })
          .select()
          .maybeSingle();

        if (!error) {
          savedData = data;
          lastError = null;
          break;
        }

        // Check if error is due to an unmigrated column in Supabase schema cache
        const missingColMatch = error.message && error.message.match(/Could not find the '([^']+)' column/i);
        if (missingColMatch && missingColMatch[1]) {
          const colToRemove = missingColMatch[1];
          console.warn(`[ProfileModal] Column '${colToRemove}' missing in Supabase schema cache. Adapting payload...`);
          delete currentPayload[colToRemove];
          lastError = error;
          continue;
        }

        // Try standard update as fallback if upsert had a non-schema conflict
        const { data: updateData, error: updateErr } = await supabase
          .from("profiles")
          .update(currentPayload)
          .eq("id", currentUser.id)
          .select()
          .maybeSingle();

        if (!updateErr) {
          savedData = updateData;
          lastError = null;
          break;
        }

        const updateColMatch = updateErr.message && updateErr.message.match(/Could not find the '([^']+)' column/i);
        if (updateColMatch && updateColMatch[1]) {
          const colToRemove = updateColMatch[1];
          console.warn(`[ProfileModal] Column '${colToRemove}' missing in Supabase schema cache on update. Adapting payload...`);
          delete currentPayload[colToRemove];
          lastError = updateErr;
          continue;
        }

        lastError = error || updateErr;
        break;
      }

      if (lastError && !savedData) {
        throw lastError;
      }

      // Merge saved database row with submitted fields so client state is fully populated
      onSuccess({
        ...(savedData || {}),
        ...profilePayload,
      });
    } catch (err: any) {
      console.error("Failed to complete profile:", err);
      setSubmitError(
        err?.message || 
        t("profile_modal.save_failed", "Unable to save profile to database. Please verify your connection.")
      );
      setShakeTrigger((prev) => prev + 1);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/75 backdrop-blur-md flex items-center justify-center p-4 sm:p-6"
      onClick={triggerBypassPreventionNotice}
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-completion-title"
    >
      {/* Modal Container with Framer Motion Shake Animation */}
      <motion.div
        key={shakeTrigger}
        onClick={(e) => e.stopPropagation()} // Prevent triggering backdrop notice when clicking inside
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={
          shakeTrigger > 0
            ? {
                opacity: 1,
                scale: 1,
                y: 0,
                x: [-6, 6, -5, 5, -2, 2, 0],
                transition: { duration: 0.4 }
              }
            : { opacity: 1, scale: 1, y: 0, transition: { duration: 0.3 } }
        }
        className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-emerald-500/20 overflow-hidden relative text-left"
      >
        {/* Top Accent Gradient Bar */}
        <div className="h-2 w-full bg-gradient-to-r from-emerald-600 via-green-600 to-teal-500" />

        {/* Modal Header */}
        <div className="p-6 sm:p-8 pb-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200/80 flex items-center justify-center text-emerald-700 shrink-0 shadow-xs">
              <ShieldCheck className="w-6 h-6 text-emerald-600" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                  {t("profile_modal.badge_required", "Action Required")}
                </span>
                <span className="text-[11px] font-semibold text-gray-400 flex items-center gap-1">
                  <Lock className="w-3 h-3 text-gray-400" />
                  {t("profile_modal.secure_setup", "Encrypted Account")}
                </span>
              </div>
              <h2 id="profile-completion-title" className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
                {t("profile_modal.title", "Complete Your Profile")}
              </h2>
              <p className="text-xs text-gray-600 leading-relaxed">
                {t(
                  "profile_modal.subtitle", 
                  "To activate real-time digital twin monitoring and tailored agronomy advisory, please verify your details. Name and Phone are compulsory."
                )}
              </p>
            </div>
          </div>

          {/* Bypass Prevention Banner if user clicks backdrop or presses escape */}
          <AnimatePresence>
            {backdropClickNotice && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-semibold flex items-center gap-2 overflow-hidden shadow-xs"
              >
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  {t(
                    "profile_modal.mandatory_notice", 
                    "Profile completion is compulsory to proceed to the NutriPalm AI console."
                  )}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Submission Error Banner */}
          <AnimatePresence>
            {submitError && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-semibold flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span className="flex-1">{submitError}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="px-6 sm:px-8 pb-6 sm:pb-8 space-y-4">
          
          {/* 1. Full Name (Compulsory) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="modal-profile-name" className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-emerald-700" />
                <span>{t("profile_modal.name_label", "Full Name")}</span>
              </label>
              <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 tracking-wide">
                {t("profile_modal.compulsory", "Compulsory *")}
              </span>
            </div>
            <div className="relative">
              <input
                id="modal-profile-name"
                type="text"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
                }}
                placeholder={t("profile_modal.name_placeholder", "e.g. Dr. L. Ramana or Ramesh Patel")}
                className={`w-full px-4 py-3 text-xs sm:text-sm font-semibold text-gray-900 bg-white border rounded-xl focus:outline-none focus:ring-2 transition-all ${
                  errors.name
                    ? "border-red-400 focus:ring-red-200"
                    : "border-gray-300 focus:border-emerald-600 focus:ring-emerald-100"
                }`}
              />
            </div>
            {errors.name && (
              <p className="text-[11px] text-red-600 font-semibold flex items-center gap-1 mt-1">
                <AlertCircle className="w-3 h-3 shrink-0" />
                {errors.name}
              </p>
            )}
          </div>

          {/* 2. Phone Number (Compulsory) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="modal-profile-phone" className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-emerald-700" />
                <span>{t("profile_modal.phone_label", "Phone Number")}</span>
              </label>
              <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 tracking-wide">
                {t("profile_modal.compulsory", "Compulsory *")}
              </span>
            </div>
            <div className="relative">
              <input
                id="modal-profile-phone"
                type="tel"
                required
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (errors.phone) setErrors((prev) => ({ ...prev, phone: undefined }));
                }}
                placeholder={t("profile_modal.phone_placeholder", "+91 94401 23456")}
                className={`w-full px-4 py-3 text-xs sm:text-sm font-semibold text-gray-900 bg-white border rounded-xl focus:outline-none focus:ring-2 transition-all ${
                  errors.phone
                    ? "border-red-400 focus:ring-red-200"
                    : "border-gray-300 focus:border-emerald-600 focus:ring-emerald-100"
                }`}
              />
            </div>
            {errors.phone ? (
              <p className="text-[11px] text-red-600 font-semibold flex items-center gap-1 mt-1">
                <AlertCircle className="w-3 h-3 shrink-0" />
                {errors.phone}
              </p>
            ) : (
              <p className="text-[10.5px] text-gray-500">
                {t("profile_modal.phone_hint", "Used for field telemetry alerts, crop pest advisories, and SMS updates.")}
              </p>
            )}
          </div>

          {/* 3. Email (Optional) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="modal-profile-email" className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-gray-500" />
                <span>{t("profile_modal.email_label", "Email Address")}</span>
              </label>
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 tracking-wide">
                {t("profile_modal.optional", "Optional")}
              </span>
            </div>
            <input
              id="modal-profile-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
              }}
              placeholder={t("profile_modal.email_placeholder", "farmer@samruddhiorganics.in")}
              className={`w-full px-4 py-2.5 text-xs sm:text-sm font-medium text-gray-900 bg-white border rounded-xl focus:outline-none focus:ring-2 transition-all ${
                errors.email
                  ? "border-red-400 focus:ring-red-200"
                  : "border-gray-300 focus:border-emerald-600 focus:ring-emerald-100"
              }`}
            />
            {errors.email && (
              <p className="text-[11px] text-red-600 font-semibold flex items-center gap-1 mt-1">
                <AlertCircle className="w-3 h-3 shrink-0" />
                {errors.email}
              </p>
            )}
          </div>

          {/* 4. Date of Birth (Optional) & Address (Optional) in 2 columns or stack */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* Date of Birth (DOB) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="modal-profile-dob" className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-gray-500" />
                  <span>{t("profile_modal.dob_label", "Date of Birth")}</span>
                </label>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 tracking-wide">
                  {t("profile_modal.optional", "Optional")}
                </span>
              </div>
              <input
                id="modal-profile-dob"
                type="date"
                max={new Date().toISOString().split("T")[0]}
                value={dob}
                onChange={(e) => {
                  setDob(e.target.value);
                  if (errors.dob) setErrors((prev) => ({ ...prev, dob: undefined }));
                }}
                className={`w-full px-3 py-2.5 text-xs sm:text-sm font-medium text-gray-900 bg-white border rounded-xl focus:outline-none focus:ring-2 transition-all ${
                  errors.dob
                    ? "border-red-400 focus:ring-red-200"
                    : "border-gray-300 focus:border-emerald-600 focus:ring-emerald-100"
                }`}
              />
              {errors.dob && (
                <p className="text-[11px] text-red-600 font-semibold flex items-center gap-1 mt-1">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  {errors.dob}
                </p>
              )}
            </div>

            {/* Address */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="modal-profile-address" className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-gray-500" />
                  <span>{t("profile_modal.address_label", "Address")}</span>
                </label>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 tracking-wide">
                  {t("profile_modal.optional", "Optional")}
                </span>
              </div>
              <input
                id="modal-profile-address"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={t("profile_modal.address_placeholder", "Village, District or Region")}
                className="w-full px-3 py-2.5 text-xs sm:text-sm font-medium text-gray-900 bg-white border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:border-emerald-600 focus:ring-emerald-100 transition-all"
              />
            </div>

          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-[#166534] hover:bg-[#14532d] text-white font-extrabold px-6 py-3.5 rounded-xl hover:shadow-lg active:scale-[0.99] transition-all duration-200 text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-60 disabled:cursor-not-allowed border-0"
            >
              {isSubmitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                  <span>{t("profile_modal.saving", "Saving Profile...")}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{t("profile_modal.submit", "Save & Enter Platform")}</span>
                  <ArrowRight className="w-4 h-4 ml-1" />
                </>
              )}
            </button>
          </div>

          {/* Footer: Sign Out / Account Switcher for safe exit if user made a mistake */}
          <div className="text-center pt-2 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-500">
            <span className="truncate max-w-[220px]">
              {currentUser?.email ? `${currentUser.email}` : t("profile_modal.logged_in", "Logged in")}
            </span>
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-1 text-gray-500 hover:text-red-600 transition-colors cursor-pointer font-semibold bg-transparent border-0 p-0"
            >
              <LogOut className="w-3 h-3" />
              <span>{t("profile_modal.sign_out", "Sign out")}</span>
            </button>
          </div>

        </form>
      </motion.div>
    </div>
  );
};
