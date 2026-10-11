# README Demo — Copy/Paste Commands

Chạy tại thư mục gốc repo. Trước khi chạy, điền token vào `.env`:

```env
NGROK_AUTHTOKEN=your_real_token
```

# CASE 1 — Nginx public, native backend private

Start:

```powershell
docker compose down -v
docker compose up -d --build
docker compose ps
```

Lấy URL Frontend/Nginx:

```powershell
docker run --rm --network mini-shop-private_edge-net curlimages/curl:latest http://ngrok:4040/api/tunnels
```

Giả sử URL là `https://xxxx.ngrok-free.app`.

Test:

```powershell
curl.exe -H "ngrok-skip-browser-warning: 1" https://xxxx.ngrok-free.app/shop/products
curl.exe -i -H "ngrok-skip-browser-warning: 1" https://xxxx.ngrok-free.app/api/catalog/products
curl.exe -i -H "ngrok-skip-browser-warning: 1" https://xxxx.ngrok-free.app/api/order/orders
curl.exe --max-time 3 http://localhost:8002/products
curl.exe --max-time 3 http://localhost:8003/orders
```

Kỳ vọng:

```text
/shop/products            ✅
/api/catalog/products     ❌ 404
/api/order/orders         ❌ 404
localhost:8002            ❌
localhost:8003            ❌
```

Nginx container gọi backend nội bộ qua `service-net`:

```powershell
docker compose exec frontend-service wget -qO- http://catalog-service:8002/products
```

Network boundary:

```powershell
docker compose exec order-service python -c "import socket; print(socket.gethostbyname('catalog-service'))"
docker compose exec order-service python -c "import socket; print(socket.gethostbyname('redis'))"
docker compose exec catalog-service node -e "require('dns').lookup('postgres',(e,a)=>console.log(e||a))"
```

Kỳ vọng: Order thấy Catalog; Order không thấy Redis; Catalog không thấy PostgreSQL.

Xong Case 1:

```powershell
docker compose down
```

---

# CASE 2 — 3 public URL độc lập từ 1 ngrok agent

Case 2 dùng một container `ngrok` chạy ba tunnel (`frontend`, `order`, `catalog`) trong cùng một agent session.

Start:

```powershell
docker compose -f compose.public.yaml down -v
docker compose -f compose.public.yaml up -d --build
docker compose -f compose.public.yaml ps
```

Kỳ vọng chỉ có **một** service ngrok:

```text
mini-shop-public-ngrok-1    Up
```

Lấy cả 3 URL:

```powershell
docker run --rm --network mini-shop-public_edge-net curlimages/curl:latest http://ngrok:4040/api/tunnels
```

Trong JSON tìm các tunnel tên:

```text
frontend
order
catalog
```

Mỗi tunnel có `public_url` riêng:

```text
FE_URL       = public_url của frontend
ORDER_URL    = public_url của order
CATALOG_URL  = public_url của catalog
```

Test trên browser/Postman:

```text
FE_URL/              -> React frontend
ORDER_URL/orders     -> Order API
CATALOG_URL/products -> Catalog API
```

Không có host-port bypass:

```powershell
curl.exe --max-time 3 http://localhost:8002/products
curl.exe --max-time 3 http://localhost:8003/orders
```

Cả hai phải fail.

Create order trực tiếp qua Order public tunnel:

```text
POST ORDER_URL/orders
Content-Type: application/json
ngrok-skip-browser-warning: 1
```

Body:

```json
{
  "customer_name": "Nguyen Van An",
  "customer_email": "an@example.com",
  "product_id": 1,
  "quantity": 2
}
```

Kỳ vọng `201 Created`.

Internal Order -> Catalog vẫn dùng Docker network, không đi vòng Internet:

```powershell
docker compose -f compose.public.yaml exec order-service python -c "import socket; print(socket.gethostbyname('catalog-service'))"
```

Datastore boundary vẫn giữ:

```powershell
docker compose -f compose.public.yaml exec order-service python -c "import socket; print(socket.gethostbyname('redis'))"
docker compose -f compose.public.yaml exec catalog-service node -e "require('dns').lookup('postgres',(e,a)=>console.log(e||a))"
```

Business data:

```powershell
docker compose -f compose.public.yaml exec postgres psql -U shopuser -d shopdb -c "SELECT customer_name, product_name, quantity, total FROM orders ORDER BY created_at DESC;"
docker compose -f compose.public.yaml exec redis redis-cli HGETALL product:1
```

Cleanup:

```powershell
docker compose -f compose.public.yaml down
```

---

# Câu chốt

```text
CASE 1
Internet -> ngrok -> Frontend/Nginx -> selected /shop routes -> backend private

CASE 2
Internet -> FE tunnel      -> Frontend
Internet -> Order tunnel   -> Order API
Internet -> Catalog tunnel -> Catalog API
```

Case 1 dùng Nginx reverse proxy cho các route frontend cần. Case 2 không reverse proxy business API qua frontend; Order và Catalog có public URL riêng.
