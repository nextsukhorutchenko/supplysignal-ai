import { PRODUCT_NAME, PRODUCT_TAGLINE } from "../src/config/product";

export default function HomePage() {
  return (
    <main>
      <h1>{PRODUCT_NAME}</h1>
      <p>{PRODUCT_TAGLINE}</p>
    </main>
  );
}
