# Architecture — 2 Microservices, 2 Exposure Models

Project có hai business microservices: **Order** và **Catalog**.

## Business ownership

```text
Order Service                          Catalog Service
- create/list orders                   - list products
- customer snapshot                    - price + stock
- persist order                        - reserve stock
       |                                      |
       v                                      v
   PostgreSQL                               Redis
```

Order gọi Catalog bằng REST. Order không đọc Redis trực tiếp; Catalog không đọc PostgreSQL trực tiếp.

## Network model chung

```text
                     service-net
             +-----------------------+
             |                       |
             v                       v
       order-service ----------> catalog-service
             |                       |
      order-data-net          catalog-data-net
             |                       |
             v                       v
          postgres                  redis
```

---

# Case 1 — Nginx reverse proxy, native backend private

Deployment: `compose.yaml`.

```text
                         INTERNET
                            |
                         HTTPS
                            |
                            v
                         ngrok
                            |
                         edge-net
                            |
                            v
                +-----------------------+
                | Frontend + Nginx      |
                | selected reverse proxy|
                +-----------+-----------+
                            |
                       service-net
                    /               \
                   v                 v
            order-service -----> catalog-service
                 |                    |
          order-data-net       catalog-data-net
                 |                    |
             PostgreSQL              Redis
```

Ngrok chỉ tunnel vào `frontend-service:80`. Nginx serve React và reverse proxy **chỉ các route được chọn**:

```text
GET  /shop/products  -> catalog-service:8002/products
GET  /shop/orders    -> order-service:8003/orders
POST /shop/checkout  -> order-service:8003/orders
```

Các route `/shop/system/...` cũng được proxy riêng cho UI. Không có generic `/api/*` proxy:

```text
/api/order/*    -> 404
/api/catalog/*  -> 404
```

### Network membership Case 1

| Component | edge-net | service-net |
|---|:---:|:---:|
| frontend-service | ✅ | ✅ |
| ngrok | ✅ | ❌ |
| order-service | ❌ | ✅ |
| catalog-service | ❌ | ✅ |

Điểm quan trọng: Nginx là thành phần reverse proxy nối public entry point với backend private qua `service-net`. Order/Catalog không có public URL riêng và không publish host port.

Ngrok có Traffic Policy/Gateway cho routing nâng cao, nhưng policy cần cho demo này bị giới hạn bởi plan hiện tại; vì vậy demo dùng Nginx để reverse proxy.

---

# Case 2 — ba public URL độc lập từ một ngrok agent

Deployment: `compose.public.yaml`.

```text
                         INTERNET
            +---------------+---------------+
            |               |               |
            v               v               v
       FE public URL    Order public URL  Catalog public URL
            |               |               |
            +---------------+---------------+
                            |
                    one ngrok agent
                            |
             +--------------+--------------+
             |              |              |
             v              v              v
         frontend      order-service   catalog-service
                           |                |
                    order-data-net   catalog-data-net
                           |                |
                       PostgreSQL          Redis
```

`ngrok/ngrok.yml` tạo ba tunnel:

```text
frontend -> frontend-service:80
order    -> order-service:8003
catalog  -> catalog-service:8002
```

Order và Catalog có **public URL riêng**, nên browser/Postman có thể gọi native API trực tiếp.

Frontend Nginx Case 2 chỉ serve React và expose `/runtime/tunnels` để React discover backend URL. Business API không reverse proxy qua frontend.

Internal service-to-service vẫn là:

```text
order-service -> service-net -> catalog-service:8002
```

---

# So sánh exposure boundary

| | Case 1 | Case 2 |
|---|---|---|
| Frontend public | ✅ | ✅ |
| Reverse proxy business routing | Nginx | Không shared reverse proxy |
| Order có public URL riêng | ❌ | ✅ |
| Catalog có public URL riêng | ❌ | ✅ |
| Host publish 8002/8003 | ❌ | ❌ |
| Database public | ❌ | ❌ |
| Order -> Catalog nội bộ | ✅ | ✅ |

```text
CASE 1
one public URL -> ngrok -> Nginx -> selected /shop/* -> private backend

CASE 2
FE_URL       -> FE
ORDER_URL    -> Order
CATALOG_URL  -> Catalog
```

# Boundary proof

```powershell
# Order thấy Catalog
docker compose exec order-service python -c "import socket; print(socket.gethostbyname('catalog-service'))"

# Order không thấy Redis
docker compose exec order-service python -c "import socket; print(socket.gethostbyname('redis'))"

# Catalog không thấy PostgreSQL
docker compose exec catalog-service node -e "require('dns').lookup('postgres',(e,a)=>console.log(e||a))"

# Frontend Nginx Case 1 thấy Catalog qua service-net
docker compose exec frontend-service wget -qO- http://catalog-service:8002/products
```
