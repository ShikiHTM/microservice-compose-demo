# Windows CMD Demo

Trước khi chạy, điền `NGROK_AUTHTOKEN` vào `.env`.

## Case 1 — ngrok -> Frontend/BFF, backend private

```cmd
docker compose down -v
docker compose up -d --build
docker compose ps
```

Lấy URL:

```cmd
docker run --rm --network mini-shop-private_edge-net curlimages/curl:latest http://ngrok:4040/api/tunnels
```

Test BFF:

```cmd
curl -H "ngrok-skip-browser-warning: 1" https://xxxx.ngrok-free.app/shop/products
curl -i -H "ngrok-skip-browser-warning: 1" https://xxxx.ngrok-free.app/api/order/orders
curl -i -H "ngrok-skip-browser-warning: 1" https://xxxx.ngrok-free.app/api/catalog/products
```

Không có host-port bypass:

```cmd
curl http://localhost:8002/products
curl http://localhost:8003/orders
```

BFF gọi Catalog nội bộ:

```cmd
docker compose exec frontend-bff node -e "fetch('http://catalog-service:8002/products').then(r=>r.text()).then(console.log)"
```

Xong Case 1:

```cmd
docker compose down
```

## Case 2 — 3 public URL từ 1 ngrok agent

```cmd
docker compose -f compose.public.yaml down -v
docker compose -f compose.public.yaml up -d --build
docker compose -f compose.public.yaml ps
```

Lấy cả 3 tunnel từ một agent:

```cmd
docker run --rm --network mini-shop-public_edge-net curlimages/curl:latest http://ngrok:4040/api/tunnels
```

Trong JSON tìm `name` là `frontend`, `order`, `catalog` và lấy từng `public_url`.

Test từng public endpoint riêng:

```cmd
curl -H "ngrok-skip-browser-warning: 1" https://ORDER_URL/orders
curl -H "ngrok-skip-browser-warning: 1" https://CATALOG_URL/products
```

Host ports vẫn đóng:

```cmd
curl http://localhost:8002/products
curl http://localhost:8003/orders
```

Cleanup:

```cmd
docker compose -f compose.public.yaml down
```
