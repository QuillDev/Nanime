import logoUrl from "../assets/nanime-logo.svg";

interface BrandLogoProps {
  readonly className: string;
}

export function BrandLogo({ className }: BrandLogoProps): React.JSX.Element {
  return <img src={logoUrl} alt="Nanime" className={className} />;
}
