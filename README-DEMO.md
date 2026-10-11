# README Demo — Copy/Paste Commands

Trước khi chạy, đặt token trong `.env`:

```env
NGROK_AUTHTOKEN=your_real_token
```

# CASE 1 — ngrok reverse proxy, backend không có public URL riêng

```powershell
docker compose down -v --remove-orphans
docker compose up -d --build
docker compose ps
```

Lấy public URL:

```powershell
docker run --rm --network mini-shop-private_edge-net curlimages/curl:latest http://ngrok:4040/api/tunnels
```

Trong JSON tìm endpoint/tunnel tên `public`. Giả sử:

```powershell
$base="https://xxxx.ngrok.app"
```

Test route do ngrok Traffic Policy reverse proxy:

```powershell
curl.exe -H "ngrok-skip-browser-warning: 1" "$base/shop/products"
curl.exe -H "ngrok-skip-browser-warning: 1" "$base/shop/orders"
```

Raw backend API bị chặn ngay tại ngrok edge:

```powershell
curl.exe -i -H "ngrok-skip-browser-warning: 1" "$base/api/order/orders"
curl.exe -i -H "ngrok-skip-browser-warning: 1" "$base/api/catalog/products"
```

Kỳ vọng `404`.

Host ports vẫn đóng:

```powershell
curl.exe --max-time 3 http://localhost:8002/products
curl.exe --max-time 3 http://localhost:8003/orders
```

Frontend Nginx bây giờ **không nằm trên service-net**, nên thử frontend resolve Catalog phải fail:

```powershell
docker compose exec frontend-service wget -T 3 -O - http://catalog-service:8002/products
```

Điều đó là đúng kiến trúc: ngrok mới là reverse proxy nằm trên `edge-net` + `service-net`.

Network/data boundary:

```powershell
docker compose exec order-service python -c "import socket; print(socket.gethostbyname('catalog-service'))"
docker compose exec order-service python -c "import socket; print(socket.gethostbyname('redis'))"
docker compose exec catalog-service node -e "require('dns').lookup('postgres',(e,a)=>console.log(e||a))"
```

Kỳ vọng: Order thấy Catalog; Order không thấy Redis; Catalog không thấy PostgreSQL.

Tạo order trên UI hoặc gọi public selected route:

```text
POST BASE/shop/checkout
Content-Type: application/json
```

```json
{
  "customer_name": "Nguyen Van An",
  "customer_email": "an@example.com",
  "product_id": 1,
  "quantity": 2
}
```

Xong Case 1:

```powershell
docker compose down
```

---

# CASE 2 — 3 public URL độc lập từ 1 ngrok agent

```powershell
docker compose -f compose.public.yaml down -v --remove-orphans
docker compose -f compose.public.yaml up -d --build
docker compose -f compose.public.yaml ps
```

Lấy cả 3 URL:

```powershell
docker run --rm --network mini-shop-public_edge-net curlimages/curl:latest http://ngrok:4040/api/tunnels
```

Tìm `frontend`, `order`, `catalog` và lấy từng `public_url`:

```text
FE_URL       = public_url của frontend
ORDER_URL    = public_url của order
CATALOG_URL  = public_url của catalog
```

Test:

```text
FE_URL/              -> React frontend
ORDER_URL/orders     -> native Order API
CATALOG_URL/products -> native Catalog API
```

Không có host-port bypass:

```powershell
curl.exe --max-time 3 http://localhost:8002/products
curl.exe --max-time 3 http://localhost:8003/orders
```

Create order trực tiếp qua native public Order API:

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

Internal Order -> Catalog vẫn dùng Docker network:

```powershell
docker compose -f compose.public.yaml exec order-service python -c "import socket; print(socket.gethostbyname('catalog-service'))"
```

Datastore boundary:

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

# Câu chốt

```text
CASE 1
one public ngrok URL + Traffic Policy reverse proxy
selected /shop/* -> private internal endpoints
/api/* -> 404

CASE 2
FE_URL       -> FE
ORDER_URL    -> Order API
CATALOG_URL  -> Catalog API
```
