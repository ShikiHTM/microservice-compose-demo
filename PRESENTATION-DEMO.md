# Presentation Demo — 2 Microservices / 2 Exposure Models

## 0. Business architecture

```text
Order Service -> Catalog Service
     |               |
 PostgreSQL         Redis
```

Nói:

> Em dùng hai business service có ownership rõ: Order sở hữu order data trong PostgreSQL, Catalog sở hữu product/stock trong Redis. Order muốn reserve stock phải gọi Catalog API, không truy cập Redis trực tiếp.

---

# CASE 1 — ngrok tunnel + Nginx reverse proxy

Start:

```powershell
docker compose down -v --remove-orphans
docker compose up -d --build
docker compose ps
```

Lấy public URL:

```powershell
docker run --rm --network mini-shop-private_edge-net curlimages/curl:latest http://ngrok:4040/api/tunnels
```

Nói:

> Case 1 ngrok chỉ tạo public HTTPS tunnel vào Frontend/Nginx. Nginx serve React và reverse proxy các route `/shop/*` được chọn tới backend private. Order và Catalog không có public URL riêng.

Flow:

```text
Internet -> ngrok -> Nginx
                      |
                      +-- / ----------------> React
                      +-- /shop/products ---> Catalog
                      +-- /shop/orders -----> Order
                      +-- /shop/checkout ---> Order
                      X-- /api/* -----------> 404
```

Test:

```text
BASE/                     ✅ FE
BASE/shop/products        ✅
BASE/shop/orders          ✅
BASE/api/order/orders     ❌ 404
localhost:8002            ❌
localhost:8003            ❌
```

Chứng minh Nginx thấy Catalog nội bộ:

```powershell
docker compose exec frontend-service wget -qO- http://catalog-service:8002/products
```

Câu chốt:

> Case 1 chỉ có một public URL. Ngrok làm HTTPS tunnel; Nginx làm reverse proxy có chọn lọc; native Order/Catalog không có public endpoint riêng.

Nếu thầy hỏi ngrok có reverse proxy được không:

> Có, ngrok có Traffic Policy/Gateway cho routing nâng cao. Nhưng policy cần cho demo này bị giới hạn bởi plan hiện tại, nên em dùng Nginx để reverse proxy và dùng ngrok cho HTTPS tunnel.

Xong Case 1:

```powershell
docker compose down
```

---

# CASE 2 — ba public URL độc lập, một ngrok agent

Start:

```powershell
docker compose -f compose.public.yaml down -v --remove-orphans
docker compose -f compose.public.yaml up -d --build
docker compose -f compose.public.yaml ps
```

Lấy cả 3 URL:

```powershell
docker run --rm --network mini-shop-public_edge-net curlimages/curl:latest http://ngrok:4040/api/tunnels
```

Tìm `frontend`, `order`, `catalog`.

Nói:

> Case 2 không dùng shared reverse proxy cho business API. Frontend, Order và Catalog mỗi service có public URL riêng, dù ba tunnel cùng chạy trong một ngrok agent session.

Flow:

```text
Browser -> FE_URL       -> Frontend Nginx
Postman -> ORDER_URL    -> Order API
Postman -> CATALOG_URL  -> Catalog API
```

Test:

```text
FE_URL/              ✅
ORDER_URL/orders     ✅
CATALOG_URL/products ✅
localhost:8002       ❌
localhost:8003       ❌
```

Postman tạo order trực tiếp:

```text
POST ORDER_URL/orders
Content-Type: application/json
ngrok-skip-browser-warning: 1
```

```json
{
  "customer_name": "Nguyen Van An",
  "customer_email": "an@example.com",
  "product_id": 1,
  "quantity": 2
}
```

## Câu kết

> Case 1: một public ngrok URL đi vào Nginx reverse proxy, backend private. Case 2: Order và Catalog có public ngrok URL riêng để client gọi native API trực tiếp. Database ở cả hai case vẫn private.
