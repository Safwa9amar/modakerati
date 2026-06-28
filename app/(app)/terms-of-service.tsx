import { useTranslation } from "react-i18next";
import { LegalDocument } from "@/components/LegalDocument";
import { getLegalDoc } from "@/lib/legal-content";

export default function TermsOfServiceScreen() {
  const { t, i18n } = useTranslation();
  return <LegalDocument title={t("settings.terms")} doc={getLegalDoc("terms", i18n.language)} />;
}
