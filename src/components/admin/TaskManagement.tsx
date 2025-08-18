import React, { useState, useEffect } from 'react';
import { ref, get, push, set, update, remove } from 'firebase/database';
import { db } from '../../firebase/config';
import { Task, Product, User, Warehouse, DeliveryPoint, ProductionLine, Truck } from '../../types';
import { Plus, Package, Users, MapPin, Calendar, Truck as TruckIcon, AlertTriangle } from 'lucide-react';
import { generateUniqueId } from '../../utils/qrGenerator';

const TaskManagement: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [deliveryPoints, setDeliveryPoints] = useState<DeliveryPoint[]>([]);
  const [productionLines, setProductionLines] = useState<ProductionLine[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  
  const [formData, setFormData] = useState({
    taskType: 'productionToWarehouse' as 'productionToWarehouse' | 'warehouseToTruck' | 'productionToTruck',
    productId: '',
    fromId: '',
    toId: '',
    assignedTo: '',
    palletQuantity: 1,
    selectedPallets: [] as any[]
  });

  useEffect(() => {
    fetchAllData();
  }, []);

  const fetchAllData = async () => {
    try {
      setLoading(true);
      const [
        productsSnapshot,
        usersSnapshot,
        warehousesSnapshot,
        deliveryPointsSnapshot,
        productionLinesSnapshot,
        trucksSnapshot,
        tasksSnapshot
      ] = await Promise.all([
        get(ref(db, 'products')),
        get(ref(db, 'users')),
        get(ref(db, 'warehouses')),
        get(ref(db, 'deliveryPoints')),
        get(ref(db, 'productionLines')),
        get(ref(db, 'trucks')),
        get(ref(db, 'tasks'))
      ]);

      setProducts(productsSnapshot.exists() 
        ? Object.keys(productsSnapshot.val()).map(key => ({ id: key, ...productsSnapshot.val()[key] }))
        : []);

      setUsers(usersSnapshot.exists()
        ? Object.keys(usersSnapshot.val()).map(key => ({ id: key, ...usersSnapshot.val()[key] }))
        : []);

      setWarehouses(warehousesSnapshot.exists()
        ? Object.keys(warehousesSnapshot.val()).map(key => ({ id: key, ...warehousesSnapshot.val()[key] }))
        : []);

      setDeliveryPoints(deliveryPointsSnapshot.exists()
        ? Object.keys(deliveryPointsSnapshot.val()).map(key => ({ id: key, ...deliveryPointsSnapshot.val()[key] }))
        : []);

      setProductionLines(productionLinesSnapshot.exists()
        ? Object.keys(productionLinesSnapshot.val()).map(key => ({ id: key, ...productionLinesSnapshot.val()[key] }))
        : []);

      setTrucks(trucksSnapshot.exists()
        ? Object.keys(trucksSnapshot.val()).map(key => ({ id: key, ...trucksSnapshot.val()[key] }))
        : []);

      setTasks(tasksSnapshot.exists()
        ? Object.keys(tasksSnapshot.val()).map(key => ({ id: key, ...tasksSnapshot.val()[key] }))
        : []);

    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getNextProductionNumber = async (): Promise<number> => {
    try {
      const settingsRef = ref(db, 'settings/lastProductionNumber');
      const snapshot = await get(settingsRef);
      const lastNumber = snapshot.exists() ? snapshot.val() : 0;
      const nextNumber = lastNumber + 1;
      await set(settingsRef, nextNumber);
      return nextNumber;
    } catch (error) {
      console.error('Error getting production number:', error);
      return Date.now();
    }
  };

  const getAvailablePallets = (warehouseId: string, productId: string) => {
    const warehouse = warehouses.find(w => w.id === warehouseId);
    if (!warehouse?.inventory?.[productId]) return [];

    const productInventory = warehouse.inventory[productId];
    const availablePallets: any[] = [];

    if (productInventory.batches) {
      Object.entries(productInventory.batches).forEach(([batchId, batch]) => {
        for (let i = 0; i < batch.palletQuantity; i++) {
          availablePallets.push({
            batchId,
            palletIndex: i,
            productionNumber: batch.productionNumber,
            expirationDate: batch.expirationDate,
            id: `${batchId}_${i}`
          });
        }
      });
    }

    return availablePallets;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const selectedProduct = products.find(p => p.id === formData.productId);
      const selectedDriver = users.find(u => u.id === formData.assignedTo);
      
      if (!selectedProduct || !selectedDriver) {
        alert('Ürün veya şöför seçimi geçersiz!');
        return;
      }

      let fromLocation = '';
      let fromQrCode = '';
      let toLocation = '';
      let toQrCode = '';
      let productionNumber = 0;

      // Görev tipine göre lokasyon bilgilerini ayarla
      if (formData.taskType === 'productionToWarehouse') {
        const productionLine = productionLines.find(pl => pl.id === formData.fromId);
        const warehouse = warehouses.find(w => w.id === formData.toId);
        
        if (!productionLine || !warehouse) {
          alert('Üretim hattı veya depo seçimi geçersiz!');
          return;
        }

        fromLocation = productionLine.name;
        fromQrCode = productionLine.qrCode;
        toLocation = warehouse.name;
        toQrCode = warehouse.qrCode;
        productionNumber = await getNextProductionNumber();

      } else if (formData.taskType === 'warehouseToTruck') {
        const warehouse = warehouses.find(w => w.id === formData.fromId);
        const truck = trucks.find(t => t.id === formData.toId);
        
        if (!warehouse || !truck) {
          alert('Depo veya tır seçimi geçersiz!');
          return;
        }

        // Seçilen paletleri kontrol et
        if (formData.selectedPallets.length === 0) {
          alert('Lütfen en az bir palet seçin!');
          return;
        }

        // Tır kapasitesi kontrolü
        const truckStats = calculateTruckStats(truck);
        if (truckStats.available < formData.selectedPallets.length) {
          alert(`Tır kapasitesi yetersiz! Mevcut boş kapasite: ${truckStats.available} palet`);
          return;
        }

        fromLocation = warehouse.name;
        fromQrCode = warehouse.qrCode;
        toLocation = truck.name;
        toQrCode = truck.qrCode;
        productionNumber = formData.selectedPallets[0]?.productionNumber || 0;

        // Tırda yer rezerve et (henüz stoktan düşürme)
        await reserveTruckSpace(truck.id, formData.productId, formData.selectedPallets);

      } else if (formData.taskType === 'productionToTruck') {
        const productionLine = productionLines.find(pl => pl.id === formData.fromId);
        const truck = trucks.find(t => t.id === formData.toId);
        
        if (!productionLine || !truck) {
          alert('Üretim hattı veya tır seçimi geçersiz!');
          return;
        }

        // Tır kapasitesi kontrolü
        const truckStats = calculateTruckStats(truck);
        if (truckStats.available < formData.palletQuantity) {
          alert(`Tır kapasitesi yetersiz! Mevcut boş kapasite: ${truckStats.available} palet`);
          return;
        }

        fromLocation = productionLine.name;
        fromQrCode = productionLine.qrCode;
        toLocation = truck.name;
        toQrCode = truck.qrCode;
        productionNumber = await getNextProductionNumber();
      }

      // Son kullanma tarihi hesapla
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + (selectedProduct.expiryDays || 30));

      // Palet QR kodları oluştur
      const palletQRCodes: string[] = [];
      const timestamp = Date.now();
      const uniqueId = generateUniqueId();

      for (let i = 0; i < formData.palletQuantity; i++) {
        const palletQR = `${selectedProduct.qrCode}_${productionNumber}_${i + 1}_${toLocation}_${timestamp}_${uniqueId}`;
        palletQRCodes.push(palletQR);
      }

      // Palet durumları oluştur
      const palletStatuses = palletQRCodes.map(code => ({
        code,
        status: 'beklemede' as const
      }));

      // Görev oluştur
      const newTaskRef = push(ref(db, 'tasks'));
      const taskData: Omit<Task, 'id'> = {
        assignedTo: formData.assignedTo,
        createdAt: new Date().toISOString(),
        expirationDate: expirationDate.toISOString(),
        from: fromLocation,
        fromQrCode,
        palletQRCodes,
        palletQuantity: formData.palletQuantity,
        productName: selectedProduct.name,
        productQrCode: selectedProduct.qrCode,
        productionNumber,
        status: 'teslim_alma_dogrulama',
        taskType: formData.taskType,
        to: toLocation,
        toQrCode,
        palletStatuses,
        productId: formData.productId,
        toId: formData.toId,
        fromId: formData.fromId,
        selectedPallets: formData.selectedPallets
      };

      await set(newTaskRef, taskData);

      // Form sıfırla
      setFormData({
        taskType: 'productionToWarehouse',
        productId: '',
        fromId: '',
        toId: '',
        assignedTo: '',
        palletQuantity: 1,
        selectedPallets: []
      });
      setShowForm(false);
      
      await fetchAllData();
      alert('Görev başarıyla oluşturuldu!');

    } catch (error) {
      console.error('Error creating task:', error);
      alert('Görev oluşturulurken bir hata oluştu.');
    } finally {
      setLoading(false);
    }
  };

  const reserveTruckSpace = async (truckId: string, productId: string, selectedPallets: any[]) => {
    try {
      const truck = trucks.find(t => t.id === truckId);
      if (!truck) return;

      const truckRef = ref(db, `trucks/${truckId}`);
      const updatedTruck = { ...truck };

      if (!updatedTruck.inventory) {
        updatedTruck.inventory = {};
      }

      if (!updatedTruck.inventory[productId]) {
        updatedTruck.inventory[productId] = {
          batches: {},
          totalPallets: 0
        };
      }

      // Seçilen paletler için batch oluştur
      const batchId = `reserved_${Date.now()}_${generateUniqueId()}`;
      updatedTruck.inventory[productId].batches[batchId] = {
        palletQuantity: selectedPallets.length,
        productionNumber: selectedPallets[0]?.productionNumber || 'N/A',
        expirationDate: selectedPallets[0]?.expirationDate,
        status: 'reserved', // Rezerve durumu
        taskId: '' // Görev oluşturulduktan sonra güncellenecek
      };

      updatedTruck.inventory[productId].totalPallets += selectedPallets.length;

      await update(truckRef, { inventory: updatedTruck.inventory });
    } catch (error) {
      console.error('Error reserving truck space:', error);
    }
  };

  const calculateTruckStats = (truck: Truck) => {
    let totalPallets = 0;
    let reservedPallets = 0;
    let loadedPallets = 0;

    if (truck.inventory) {
      Object.values(truck.inventory).forEach(productInventory => {
        if (productInventory.batches) {
          Object.values(productInventory.batches).forEach(batch => {
            totalPallets += batch.palletQuantity;
            if (batch.status === 'reserved') {
              reservedPallets += batch.palletQuantity;
            } else {
              loadedPallets += batch.palletQuantity;
            }
          });
        }
      });
    }

    const capacity = truck.capacity || 0;
    const available = capacity - totalPallets;
    const usagePercentage = capacity > 0 ? Math.round((totalPallets / capacity) * 100) : 0;

    return { totalPallets, reservedPallets, loadedPallets, capacity, available, usagePercentage };
  };

  const handleTaskComplete = async (taskId: string) => {
    try {
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;

      // Görev durumunu tamamlandı olarak güncelle
      await update(ref(db, `tasks/${taskId}`), { status: 'tamamlandı' });

      if (task.taskType === 'warehouseToTruck') {
        // Depodan tıra görev tamamlandığında:
        // 1. Depo stokunu düş
        await removeFromWarehouseStock(task.fromId!, task.productId, task.selectedPallets || []);
        
        // 2. Tırdaki rezerve durumunu yüklü yap
        await updateTruckReservedToLoaded(task.toId, task.productId, taskId);
      }

      await fetchAllData();
      alert('Görev tamamlandı ve stok güncellemeleri yapıldı!');
    } catch (error) {
      console.error('Error completing task:', error);
      alert('Görev tamamlanırken bir hata oluştu.');
    }
  };

  const removeFromWarehouseStock = async (warehouseId: string, productId: string, selectedPallets: any[]) => {
    try {
      const warehouse = warehouses.find(w => w.id === warehouseId);
      if (!warehouse?.inventory?.[productId]) return;

      const warehouseRef = ref(db, `warehouses/${warehouseId}`);
      const updatedWarehouse = { ...warehouse };

      // Seçilen paletleri batch'lerden çıkar
      selectedPallets.forEach(pallet => {
        if (updatedWarehouse.inventory![productId].batches[pallet.batchId]) {
          const batch = updatedWarehouse.inventory![productId].batches[pallet.batchId];
          batch.palletQuantity -= 1;
          updatedWarehouse.inventory![productId].totalPallets -= 1;

          // Batch boşaldıysa sil
          if (batch.palletQuantity <= 0) {
            delete updatedWarehouse.inventory![productId].batches[pallet.batchId];
          }
        }
      });

      // Ürün stoku sıfırlandıysa ürünü sil
      if (updatedWarehouse.inventory![productId].totalPallets <= 0) {
        delete updatedWarehouse.inventory![productId];
      }

      await update(warehouseRef, { inventory: updatedWarehouse.inventory });
    } catch (error) {
      console.error('Error removing from warehouse stock:', error);
    }
  };

  const updateTruckReservedToLoaded = async (truckId: string, productId: string, taskId: string) => {
    try {
      const truck = trucks.find(t => t.id === truckId);
      if (!truck?.inventory?.[productId]) return;

      const truckRef = ref(db, `trucks/${truckId}`);
      const updatedTruck = { ...truck };

      // İlgili batch'i bul ve durumunu güncelle
      Object.keys(updatedTruck.inventory![productId].batches).forEach(batchId => {
        const batch = updatedTruck.inventory![productId].batches[batchId];
        if (batch.status === 'reserved' && batch.taskId === taskId) {
          batch.status = 'loaded'; // Rezerve'den yüklü'ye çevir
          delete batch.taskId; // Task ID'yi temizle
        }
      });

      await update(truckRef, { inventory: updatedTruck.inventory });
    } catch (error) {
      console.error('Error updating truck status:', error);
    }
  };

  const drivers = users.filter(user => user.role === 'sofor');

  const getFromOptions = () => {
    switch (formData.taskType) {
      case 'productionToWarehouse':
      case 'productionToTruck':
        return productionLines;
      case 'warehouseToTruck':
        return warehouses;
      default:
        return [];
    }
  };

  const getToOptions = () => {
    switch (formData.taskType) {
      case 'productionToWarehouse':
        return warehouses;
      case 'warehouseToTruck':
      case 'productionToTruck':
        return trucks;
      default:
        return [];
    }
  };

  const availablePallets = formData.taskType === 'warehouseToTruck' && formData.fromId && formData.productId
    ? getAvailablePallets(formData.fromId, formData.productId)
    : [];

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-center">
          <Package className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Veriler yükleniyor...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Görev Atama</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Yeni Görev Oluştur
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Yeni Görev Oluştur</h3>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Görev Tipi *
                </label>
                <select
                  value={formData.taskType}
                  onChange={(e) => setFormData({
                    ...formData,
                    taskType: e.target.value as any,
                    fromId: '',
                    toId: '',
                    selectedPallets: []
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="productionToWarehouse">Üretimden Depoya</option>
                  <option value="warehouseToTruck">Depodan Tıra</option>
                  <option value="productionToTruck">Üretimden Tıra</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Ürün *
                </label>
                <select
                  value={formData.productId}
                  onChange={(e) => setFormData({
                    ...formData,
                    productId: e.target.value,
                    selectedPallets: []
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="">Ürün Seçin</option>
                  {products.map(product => (
                    <option key={product.id} value={product.id}>
                      {product.name} ({product.qrCode})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Teslim Alma Noktası *
                </label>
                <select
                  value={formData.fromId}
                  onChange={(e) => setFormData({
                    ...formData,
                    fromId: e.target.value,
                    selectedPallets: []
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="">
                    {formData.taskType === 'productionToWarehouse' || formData.taskType === 'productionToTruck' 
                      ? 'Üretim Hattı Seçin' 
                      : 'Depo Seçin'}
                  </option>
                  {getFromOptions().map(option => (
                    <option key={option.id} value={option.id}>
                      {option.name} ({option.qrCode})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Teslim Etme Noktası *
                </label>
                <select
                  value={formData.toId}
                  onChange={(e) => setFormData({...formData, toId: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="">
                    {formData.taskType === 'productionToWarehouse' 
                      ? 'Depo Seçin' 
                      : 'Tır Seçin'}
                  </option>
                  {getToOptions().map(option => (
                    <option key={option.id} value={option.id}>
                      {option.name} ({option.qrCode})
                      {formData.taskType !== 'productionToWarehouse' && (
                        ` - Kapasite: ${calculateTruckStats(option as Truck).available}/${(option as Truck).capacity || 0}`
                      )}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Atanan Şöför *
                </label>
                <select
                  value={formData.assignedTo}
                  onChange={(e) => setFormData({...formData, assignedTo: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="">Şöför Seçin</option>
                  {drivers.map(driver => (
                    <option key={driver.id} value={driver.id}>
                      {driver.name} ({driver.email})
                    </option>
                  ))}
                </select>
              </div>

              {formData.taskType !== 'warehouseToTruck' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Palet Sayısı *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={formData.palletQuantity}
                    onChange={(e) => setFormData({...formData, palletQuantity: parseInt(e.target.value) || 1})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>
              )}
            </div>

            {/* Palet Seçimi (Depodan Tıra görevleri için) */}
            {formData.taskType === 'warehouseToTruck' && availablePallets.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Paletleri Seçin * (Toplam: {availablePallets.length} palet mevcut)
                </label>
                <div className="max-h-60 overflow-y-auto border border-gray-300 rounded-md p-3">
                  <div className="space-y-2">
                    {availablePallets.map((pallet, index) => (
                      <label key={pallet.id} className="flex items-center space-x-3 p-2 hover:bg-gray-50 rounded">
                        <input
                          type="checkbox"
                          checked={formData.selectedPallets.some(sp => sp.id === pallet.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({
                                ...formData,
                                selectedPallets: [...formData.selectedPallets, pallet],
                                palletQuantity: formData.selectedPallets.length + 1
                              });
                            } else {
                              const newSelected = formData.selectedPallets.filter(sp => sp.id !== pallet.id);
                              setFormData({
                                ...formData,
                                selectedPallets: newSelected,
                                palletQuantity: newSelected.length
                              });
                            }
                          }}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div className="flex-1">
                          <div className="text-sm font-medium">
                            Palet #{index + 1} - ÜN: {pallet.productionNumber}
                          </div>
                          {pallet.expirationDate && (
                            <div className="text-xs text-gray-500">
                              Son Kullanma: {new Date(pallet.expirationDate).toLocaleDateString('tr-TR')}
                            </div>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
                <p className="text-sm text-gray-500 mt-2">
                  Seçilen: {formData.selectedPallets.length} palet
                </p>
              </div>
            )}

            <div className="flex gap-4">
              <button
                type="submit"
                disabled={loading}
                className="bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white px-6 py-2 rounded-md transition-colors"
              >
                {loading ? 'Oluşturuluyor...' : 'Görev Oluştur'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="bg-gray-500 hover:bg-gray-600 text-white px-6 py-2 rounded-md transition-colors"
              >
                İptal
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Mevcut Görevler */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold mb-4">Mevcut Görevler</h3>
        
        {tasks.length === 0 ? (
          <div className="text-center py-8">
            <Package className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-500">Henüz görev oluşturulmamış</p>
          </div>
        ) : (
          <div className="space-y-4">
            {tasks.map((task) => {
              const driver = users.find(u => u.id === task.assignedTo);
              const isCompleted = task.status === 'tamamlandı';
              
              return (
                <div key={task.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h4 className="font-medium text-gray-900">{task.productName}</h4>
                      <p className="text-sm text-gray-500">
                        ÜN: {task.productionNumber} | {task.palletQuantity} Palet
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        task.status === 'teslim_alma_dogrulama' ? 'bg-yellow-100 text-yellow-800' :
                        task.status === 'devam_ediyor' ? 'bg-blue-100 text-blue-800' :
                        'bg-green-100 text-green-800'
                      }`}>
                        {task.status === 'teslim_alma_dogrulama' ? 'Beklemede' :
                         task.status === 'devam_ediyor' ? 'Devam Ediyor' : 'Tamamlandı'}
                      </span>
                      {!isCompleted && task.status === 'devam_ediyor' && (
                        <button
                          onClick={() => handleTaskComplete(task.id)}
                          className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded transition-colors"
                        >
                          Tamamla
                        </button>
                      )}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Şöför:</span>
                      <p className="font-medium">{driver?.name || 'Bilinmiyor'}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Teslim Alma:</span>
                      <p className="font-medium">{task.from}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Teslim Etme:</span>
                      <p className="font-medium">{task.to}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Son Kullanma:</span>
                      <p className="font-medium">{new Date(task.expirationDate).toLocaleDateString('tr-TR')}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskManagement;