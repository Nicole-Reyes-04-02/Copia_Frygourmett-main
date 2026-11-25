import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import XLSX from "xlsx-js-style";
import { formatCurrency } from "../supabase.js";

const REPORT_COLUMNS = ["Pedido", "Fecha y hora", "Cliente", "Detalle de platos", "Cantidad", "Total", "Estado"];
const CURRENCY_FORMAT = '"S/ " #,##0.00';
const QUANTITY_FORMAT = "#,##0.00";

function formatExportDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Fecha no disponible";
    return new Intl.DateTimeFormat("es-PE", {
        timeZone: "America/Lima",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }).format(date);
}

function safeSpreadsheetText(value) {
    const text = String(value ?? "");
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export function buildAccountingReport(orders, exportedAt = new Date()) {
    if (!Array.isArray(orders) || orders.length === 0) {
        throw new Error("No hay pedidos para exportar.");
    }

    const rows = orders.map((order) => {
        const items = Array.isArray(order.items) ? order.items : [];
        const quantity = items.reduce((sum, item) => {
            const itemQuantity = Number(item.cantidad);
            return sum + (Number.isFinite(itemQuantity) ? itemQuantity : 0);
        }, 0);
        const total = Number(order.total);

        return {
            id: String(order.id ?? ""),
            createdAt: formatExportDate(order.created_at),
            customer: String(order.cliente_nombre ?? ""),
            detail: items.map((item) => `${item.cantidad ?? 0} × ${item.nombre ?? "Plato"}`).join(", "),
            quantity,
            total: Number.isFinite(total) ? total : 0,
            status: String(order.estado ?? "")
        };
    });

    return {
        exportedAt: formatExportDate(exportedAt),
        rows,
        totalQuantity: rows.reduce((sum, row) => sum + row.quantity, 0),
        totalAmount: rows.reduce((sum, row) => sum + row.total, 0)
    };
}

export function exportOrdersPdf(orders) {
    const report = buildAccountingReport(orders);
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(31, 41, 55);
    doc.text("FRYGOURMETT - Reporte contable de pedidos", 14, 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(90, 98, 110);
    doc.text(`Exportado: ${report.exportedAt}`, 14, 22);

    autoTable(doc, {
        head: [REPORT_COLUMNS],
        body: report.rows.map((row) => [
            row.id,
            row.createdAt,
            row.customer,
            row.detail,
            row.quantity.toFixed(2),
            formatCurrency(row.total),
            row.status
        ]),
        foot: [[
            "",
            "",
            "",
            "TOTALES",
            report.totalQuantity.toFixed(2),
            formatCurrency(report.totalAmount),
            ""
        ]],
        startY: 27,
        theme: "grid",
        margin: { left: 10, right: 10 },
        styles: {
            font: "helvetica",
            fontSize: 8,
            cellPadding: 2,
            overflow: "linebreak",
            valign: "middle"
        },
        headStyles: {
            fillColor: [31, 41, 55],
            textColor: [255, 255, 255],
            fontStyle: "bold"
        },
        alternateRowStyles: { fillColor: [243, 244, 246] },
        footStyles: {
            fillColor: [31, 41, 55],
            textColor: [255, 255, 255],
            fontStyle: "bold"
        },
        columnStyles: {
            0: { cellWidth: 42 },
            1: { cellWidth: 31 },
            2: { cellWidth: 34 },
            3: { cellWidth: "auto" },
            4: { cellWidth: 20, halign: "right" },
            5: { cellWidth: 28, halign: "right" },
            6: { cellWidth: 27 }
        }
    });

    doc.save(`frygourmett-reporte-contable-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function exportOrdersExcel(orders) {
    const report = buildAccountingReport(orders);
    const headerRow = 3;
    const firstDataRow = headerRow + 1;
    const totalRow = firstDataRow + report.rows.length;
    const sheetRows = [
        ["FRYGOURMETT - Reporte contable de pedidos"],
        [`Exportado: ${report.exportedAt}`],
        [],
        REPORT_COLUMNS,
        ...report.rows.map((row) => [
            safeSpreadsheetText(row.id),
            row.createdAt,
            safeSpreadsheetText(row.customer),
            safeSpreadsheetText(row.detail),
            row.quantity,
            row.total,
            safeSpreadsheetText(row.status)
        ]),
        ["", "", "", "TOTALES", report.totalQuantity, report.totalAmount, ""]
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);

    worksheet["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: REPORT_COLUMNS.length - 1 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: REPORT_COLUMNS.length - 1 } }
    ];
    worksheet["!cols"] = [
        { wch: 38 },
        { wch: 21 },
        { wch: 24 },
        { wch: 48 },
        { wch: 14 },
        { wch: 18 },
        { wch: 20 }
    ];
    worksheet["!autofilter"] = {
        ref: `A${headerRow + 1}:G${totalRow}`
    };

    worksheet.A1.s = {
        fill: { fgColor: { rgb: "1F2937" } },
        font: { name: "Arial", sz: 16, bold: true, color: { rgb: "FFFFFF" } },
        alignment: { vertical: "center" }
    };
    worksheet.A2.s = {
        font: { name: "Arial", sz: 10, italic: true, color: { rgb: "5B6472" } }
    };
    worksheet["!rows"] = [{ hpt: 28 }, { hpt: 20 }];

    for (let column = 0; column < REPORT_COLUMNS.length; column += 1) {
        const headerCell = worksheet[XLSX.utils.encode_cell({ r: headerRow, c: column })];
        headerCell.s = {
            fill: { fgColor: { rgb: "1F2937" } },
            font: { name: "Arial", bold: true, color: { rgb: "FFFFFF" } },
            alignment: { horizontal: column === 4 || column === 5 ? "right" : "left", vertical: "center" }
        };
    }

    for (let rowIndex = firstDataRow; rowIndex < totalRow; rowIndex += 1) {
        const isAlternate = (rowIndex - firstDataRow) % 2 === 0;
        for (let column = 0; column < REPORT_COLUMNS.length; column += 1) {
            const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: column })];
            if (!cell) continue;
            cell.s = {
                fill: { fgColor: { rgb: isAlternate ? "F3F4F6" : "FFFFFF" } },
                font: { name: "Arial", sz: 10, color: { rgb: "1F2937" } },
                alignment: {
                    horizontal: column === 4 || column === 5 ? "right" : "left",
                    vertical: "center",
                    wrapText: column === 3
                }
            };
            if (column === 4 || column === 5) {
                cell.z = column === 5 ? CURRENCY_FORMAT : QUANTITY_FORMAT;
            }
        }
    }

    for (let column = 0; column < REPORT_COLUMNS.length; column += 1) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: totalRow, c: column })];
        if (!cell) continue;
        cell.s = {
            fill: { fgColor: { rgb: "1F2937" } },
            font: { name: "Arial", bold: true, color: { rgb: "FFFFFF" } },
            alignment: { horizontal: column === 4 || column === 5 ? "right" : "left", vertical: "center" }
        };
        if (column === 4 || column === 5) {
            cell.z = column === 5 ? CURRENCY_FORMAT : QUANTITY_FORMAT;
        }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Reporte contable");
    XLSX.writeFile(workbook, `frygourmett-reporte-contable-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportOrdersCsv(orders) {
    buildAccountingReport(orders);
    const columns = ["Pedido", "Cliente", "Correo", "Teléfono", "Dirección", "Distrito / Zona", "Referencia", "Platos", "Hora", "Total", "Estado", "Nota"];
    const csvValue = (value) => {
        let safeValue = String(value ?? "");
        if (/^[=+\-@]/.test(safeValue)) safeValue = `'${safeValue}`;
        return `"${safeValue.replace(/"/g, '""')}"`;
    };
    const rows = orders.map((order) => [
        order.id,
        order.cliente_nombre,
        order.cliente_email,
        order.telefono_contacto,
        order.direccion_entrega,
        order.distrito_zona,
        order.referencia,
        (Array.isArray(order.items) ? order.items : []).map((item) => `${item.cantidad} × ${item.nombre}`).join(", "),
        formatExportDate(order.created_at),
        order.total,
        order.estado,
        order.nota
    ]);
    const csv = [columns, ...rows].map((row) => row.map(csvValue).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `frygourmett-pedidos-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}
