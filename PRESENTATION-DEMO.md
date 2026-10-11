# Presentation Demo — 2 Microservices / 2 Exposure Models

Mục tiêu: chứng minh hai deployment model khác nhau dù **cả hai đều dùng ngrok HTTPS**.

## 0. Business architecture

```text
Order Service -> Catalog Service
     |               |
 PostgreSQL         Redis
```

Nói:

> Em dùng hai business service có ownership rõ: Order sở hữu order data trong PostgreSQL, Catalog sở hữu product/stock trong Redis. Order muốn reserve stock phải gọi Catalog API, không truy cập Redis trực tiếp.

---

# CASE 1 — Nginx public, backend private

Start:

```powershell
docker compose down -v
docker compose up -d --build
docker compose ps
```

Lấy URL:

```powershell
docker run --rm --network mini-shop-private_edge-net curlimages/curl:latest http://ngrok:4040/api/tunnels
```

Nói:

> Case 1 ngrok chỉ tunnel vào Frontend/Nginx. Nginx serve React và reverse proxy một số route `/shop/*` tới backend private. Order và Catalog không có public URL riêng.

Test:

```text
FE /shop/products             ✅
FE /api/order/orders          ❌ 404
localhost:8002                ❌
localhost:8003                ❌
```

Chứng minh frontend Nginx thấy Catalog nội bộ:

```powershell
docker compose exec frontend-service wget -qO- http://catalog-service:8002/products
```

Câu chốt:

> Client ngoài chỉ đi vào Nginx. Nginx mới reverse proxy các route được cho phép tới backend qua private Docker network. Native Order/Catalog endpoint không có URL Internet riêng.

Xong Case 1:

```powershell
docker compose down
```

---

# CASE 2 — ba public URL độc lập, một ngrok agent

Start:

```powershell
docker compose -f compose.public.yaml down -v
docker compose -f compose.public.yaml up -d --build
docker compose -f compose.public.yaml ps
```

Kỳ vọng chỉ có một container `ngrok`, nhưng nó chạy ba tunnel từ `ngrok/ngrok.yml`.

Lấy cả 3 URL:

```powershell
docker run --rm --network mini-shop-public_edge-net curlimages/curl:latest http://ngrok:4040/api/tunnels
```

Trong JSON tìm tunnel `frontend`, `order`, `catalog` và lấy từng `public_url`.

Nói:

> Case 2 không dùng reverse proxy business API qua frontend. Một ngrok agent mở ba public tunnel độc lập: Frontend, Order và Catalog mỗi service có URL Internet riêng.

Flow:

```text
Browser -> FE tunnel      -> Frontend Nginx
Postman -> Order tunnel   -> Order API
Postman -> Catalog tunnel -> Catalog API
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

Nói:

> Backend container vẫn không publish host port, nhưng backend API đã public qua tunnel riêng. Frontend Nginx Case 2 chỉ serve React và metadata runtime, không reverse proxy business API.

Internal Order -> Catalog vẫn dùng private network:

```powershell
docker compose -f compose.public.yaml exec order-service python -c "import socket; print(socket.gethostbyname('catalog-service'))"
```

Order -> Redis vẫn fail:

```powershell
docker compose -f compose.public.yaml exec order-service python -c "import socket; print(socket.gethostbyname('redis'))"
```

## Câu kết

> Case 1 dùng Nginx làm public reverse proxy có chọn lọc, còn Order/Catalog không có public URL riêng. Case 2 thì Order và Catalog có public ngrok URL độc lập nên client gọi trực tiếp backend API, không đi qua frontend Nginx. Database ở cả hai case vẫn private.
