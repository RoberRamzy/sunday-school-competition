import Link from "next/link";
import type { Translate } from "../api";
import { Icon } from "./ui-icon";

export function ChristmasLights() {
  return <span className="christmas-lights" aria-hidden="true">
    <span><i/><i/><i/><i/><i/></span><span><i/><i/><i/><i/><i/></span>
  </span>;
}

export function SiteBrand({ href, t }: { href: string; t: Translate }) {
  return <Link className="wordmark" href={href} prefetch={false}>
    <span className="brand-icon">
      <span className="brand-book"><Icon name="book" size={23}/></span>
      <span className="brand-tree"><Icon name="tree" size={27}/></span>
    </span>
    <span>{t("Sunday School", "مدارس الأحد")}<small>{t("Competition", "المسابقة")}</small></span>
  </Link>;
}
