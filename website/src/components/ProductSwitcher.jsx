import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Link, useLocation } from "react-router-dom";
import { currentProduct } from "../lib/productSection";

const products = [
  { id: "code", label: "code", to: "/" },
  { id: "docs", label: "docs", to: "/docs" },
];

export default function ProductSwitcher({ children, triggerClassName, contentClassName, itemClassName, testId = "product-switcher", alignOffset = 0 }) {
  const { pathname } = useLocation();
  const activeProduct = currentProduct(pathname);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={triggerClassName} aria-label="Switch DeepSeek Code section" data-testid={testId}>
          {children}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={contentClassName} sideOffset={10} align="start" alignOffset={alignOffset} aria-label="DeepSeek Code sections">
          {products.map(({ id, label, to }) => {
            const active = id === activeProduct;
            return (
              <DropdownMenu.Item key={id} asChild disabled={active}>
                {active ? (
                  <span className={itemClassName} aria-current="page" data-testid={`product-option-${id}`}>/{label}</span>
                ) : (
                  <Link className={itemClassName} to={to} data-testid={`product-option-${id}`}>/{label}</Link>
                )}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
