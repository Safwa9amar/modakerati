import { useTranslation } from "react-i18next";
import { LegalDocument } from "@/components/LegalDocument";
import { getLegalDoc } from "@/lib/legal-content";

export default function PrivacyPolicyScreen() {
  const { t, i18n } = useTranslation();
  return <LegalDocument title={t("settings.privacy")} doc={getLegalDoc("privacy", i18n.language)} />;
}
